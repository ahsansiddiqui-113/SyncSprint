import { and, asc, desc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { automationFires, automations, boardColumns, organizations, schedulerLeases, tasks, type AutomationTrigger, type Task } from "@/db/schema";
import { billingState } from "@/lib/billing-rules";
import { applyRule, conditionsHold, SCHEDULED_KINDS } from "./automations";

/**
 * Scheduled automations:
 *  - due_soon: once per task when its due date is within N days (occasion = that due date)
 *  - overdue:  once per task when it passes its due date unfinished
 *  - schedule: every day / weekday / week at a local hour, for every open task matching the conditions
 * Each firing is recorded in automation_fires (primary key = rule + subject + occasion), so
 * running the scheduler twice, or on two servers at once, never fires anything twice.
 */

const DAY = 86_400_000;
const MAX_TASKS_PER_RULE = 200;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Local date, hour and weekday (0 = Monday) of an instant in a time zone. */
export function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, weekday };
}

/** The occurrence a schedule trigger should fire for right now (its local date), or null. */
export function scheduleOccasion(t: Extract<AutomationTrigger, { kind: "schedule" }>, now: Date): string | null {
  const p = localParts(now, t.timezone);
  if (p.hour < t.hour) return null;
  if (t.every === "weekday" && p.weekday > 4) return null;
  if (t.every === "week" && p.weekday !== (t.weekday ?? 0)) return null;
  return p.date;
}

export type SchedulerResult = { rules: number; fired: number; changes: { organizationId: string; task: Task; notified: string[]; commented: boolean; tagged: boolean }[] };

/** Record a firing; false if it already happened. */
async function claim(conn: DB | Parameters<Parameters<DB["transaction"]>[0]>[0], automationId: string, subject: string, occasion: string) {
  const rows = await conn.insert(automationFires).values({ automationId, subject, occasion }).onConflictDoNothing().returning({ a: automationFires.automationId });
  return rows.length > 0;
}

export async function runScheduledAutomations(conn: DB, now = new Date()): Promise<SchedulerResult> {
  const rows = await conn
    .select({ rule: automations, org: organizations })
    .from(automations)
    .innerJoin(organizations, eq(organizations.id, automations.organizationId))
    .where(and(eq(automations.enabled, true), inArray(sql<string>`${automations.trigger}->>'kind'`, [...SCHEDULED_KINDS])))
    .orderBy(asc(automations.createdAt));
  const result: SchedulerResult = { rules: 0, fired: 0, changes: [] };
  const today = iso(now);

  for (const { rule, org } of rows) {
    if (billingState(org, now).access !== "full") continue; // paused while read-only or locked
    result.rules++;
    const [done] = await conn.select({ id: boardColumns.id }).from(boardColumns).where(eq(boardColumns.projectId, rule.projectId)).orderBy(desc(boardColumns.position)).limit(1);
    const open = and(eq(tasks.organizationId, rule.organizationId), eq(tasks.projectId, rule.projectId), done ? ne(tasks.columnId, done.id) : sql`true`);
    const t = rule.trigger;

    let candidates: Task[] = [];
    let occasionFor: (task: Task) => string;
    if (t.kind === "due_soon") {
      const until = iso(new Date(now.getTime() + t.days * DAY));
      candidates = await conn.select().from(tasks).where(and(open, gte(tasks.dueDate, today), lte(tasks.dueDate, until))).orderBy(asc(tasks.dueDate)).limit(MAX_TASKS_PER_RULE);
      occasionFor = (task) => `due:${task.dueDate}`;
    } else if (t.kind === "overdue") {
      candidates = await conn.select().from(tasks).where(and(open, lt(tasks.dueDate, today))).orderBy(asc(tasks.dueDate)).limit(MAX_TASKS_PER_RULE);
      occasionFor = (task) => `over:${task.dueDate}`;
    } else if (t.kind === "schedule") {
      const occasion = scheduleOccasion(t, now);
      if (!occasion || !(await claim(conn, rule.id, "run", `sch:${occasion}`))) continue;
      candidates = await conn.select().from(tasks).where(open).orderBy(asc(tasks.position)).limit(MAX_TASKS_PER_RULE);
      occasionFor = () => `sch:${occasion}`;
    } else continue;

    for (const task of candidates) {
      const change = await conn.transaction(async (tx) => {
        // Conditions first: a task that starts matching later (e.g. raised to high) still fires for this occasion.
        if (!(await conditionsHold(tx, task, rule.conditions))) return null;
        if (t.kind !== "schedule" && !(await claim(tx, rule.id, task.id, occasionFor(task)))) return null;
        const ctx = { today, notified: new Set<string>(), commented: new Set<string>(), tagged: new Set<string>() };
        const after = await applyRule(tx, rule.organizationId, null, rule, task, ctx);
        return { organizationId: rule.organizationId, task: after, notified: [...ctx.notified], commented: ctx.commented.size > 0, tagged: ctx.tagged.size > 0 };
      });
      if (change) {
        result.fired++;
        result.changes.push(change);
      }
    }
  }
  return result;
}

/* ------------------------------------ lease ------------------------------------ */

/** Take the named lease for `ms` if nobody holds it. Safe across server instances. */
export async function acquireLease(conn: DB, name: string, ms: number, now = new Date()) {
  await conn.insert(schedulerLeases).values({ name, lockedUntil: new Date(0) }).onConflictDoNothing();
  const got = await conn
    .update(schedulerLeases)
    .set({ lockedUntil: new Date(now.getTime() + ms) })
    .where(and(eq(schedulerLeases.name, name), lt(schedulerLeases.lockedUntil, now)))
    .returning({ name: schedulerLeases.name });
  return got.length > 0;
}

export async function releaseLease(conn: DB, name: string, now = new Date()) {
  await conn.update(schedulerLeases).set({ lockedUntil: now, lastRunAt: now }).where(eq(schedulerLeases.name, name));
}
