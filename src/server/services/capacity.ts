import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import {
  auditLogs,
  boardColumns,
  memberCapacity,
  orgMembers,
  projects,
  taskAssignees,
  tasks,
  timeOff,
  users,
  workSchedules,
  type TimeOff,
  type WeekHours,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Workload & capacity (modelled on Azure Boards capacity + ClickUp Workload):
 *  - capacity per person per day = their weekday hours (workspace schedule or a personal
 *    override), 0 on time off / workspace holidays
 *  - each open task's estimate is split evenly across its assignees, then spread evenly
 *    across that person's working days from max(start, today) to the due date
 *  - done work doesn't count; overdue open work lands on today (flagged "overdue")
 *  - load is counted across ALL projects in the workspace
 *  - over-allocation is evaluated per day, then rolled up — never only weekly
 *  - nothing here ever blocks an assignment; callers turn results into warnings
 */

export const DEFAULT_HOURS: WeekHours = [8, 8, 8, 8, 8, 0, 0];
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DAY));
const weekday = (s: string) => (toDate(s).getUTCDay() + 6) % 7; // Monday = 0
export const utcToday = () => iso(new Date());

/**
 * "Today" as the viewer sees it. Overdue work lands on today, so a UTC date would
 * put it on yesterday for anyone east of UTC after midnight. Client dates are only
 * trusted within ±1 day of the server's UTC date (every real time zone fits).
 */
export function resolveToday(clientToday?: string | null): string {
  const server = utcToday();
  if (!clientToday || !/^\d{4}-\d{2}-\d{2}$/.test(clientToday)) return server;
  const diff = Math.abs(toDate(clientToday).getTime() - toDate(server).getTime()) / DAY;
  return diff <= 1 ? clientToday : server;
}
export function weekOf(day: string) {
  const start = addDays(day, -weekday(day));
  return { from: start, to: addDays(start, 6) };
}
function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const weekHours = z.array(z.number().min(0).max(24)).length(7) as unknown as z.ZodType<WeekHours>;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function audit(conn: DbOrTx, organizationId: string, actorId: string, action: string, entityId: string, metadata: Record<string, unknown>) {
  await conn.insert(auditLogs).values({ organizationId, actorId, action, entityType: "capacity", entityId, metadata });
}

async function assertMember(conn: DbOrTx, organizationId: string, userId: string) {
  const [m] = await conn
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (!m) throw new AppError("NOT_FOUND", "Member not found");
}

/* ------------------------------ configuration ------------------------------ */

export type CapacitySettings = {
  defaultHours: WeekHours;
  nearThreshold: number;
  overrides: Record<string, WeekHours>;
};

async function loadSettings(conn: DbOrTx, organizationId: string): Promise<CapacitySettings> {
  const [sched] = await conn.select().from(workSchedules).where(eq(workSchedules.organizationId, organizationId)).limit(1);
  const overrides = await conn.select().from(memberCapacity).where(eq(memberCapacity.organizationId, organizationId));
  return {
    defaultHours: sched?.hours ?? DEFAULT_HOURS,
    nearThreshold: sched?.nearThreshold ?? 85,
    overrides: Object.fromEntries(overrides.map((o) => [o.userId, o.hours])),
  };
}

export async function getCapacitySettings(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return loadSettings(conn, organizationId);
}

/** Workspace default schedule (owners/admins). */
export async function setWorkSchedule(conn: DB, actorId: string, organizationId: string, raw: { hours: number[]; nearThreshold?: number }) {
  const hours = weekHours.parse(raw.hours);
  const nearThreshold = z.number().int().min(50).max(100).default(85).parse(raw.nearThreshold ?? 85);
  if (hours.reduce((a, b) => a + b, 0) === 0) throw new AppError("VALIDATION", "The schedule needs at least one working day");
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  await conn
    .insert(workSchedules)
    .values({ organizationId, hours, nearThreshold })
    .onConflictDoUpdate({ target: workSchedules.organizationId, set: { hours, nearThreshold, updatedAt: new Date() } });
  await audit(conn, organizationId, actorId, "SCHEDULE_UPDATED", organizationId, { hours, nearThreshold });
  return { hours, nearThreshold };
}

/** Per-person capacity override; null resets to the workspace schedule. */
export async function setMemberCapacity(conn: DB, actorId: string, organizationId: string, userId: string, raw: number[] | null) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  await assertMember(conn, organizationId, userId);
  if (raw === null) {
    await conn.delete(memberCapacity).where(and(eq(memberCapacity.organizationId, organizationId), eq(memberCapacity.userId, userId)));
    await audit(conn, organizationId, actorId, "CAPACITY_RESET", userId, {});
    return null;
  }
  const hours = weekHours.parse(raw);
  await conn
    .insert(memberCapacity)
    .values({ organizationId, userId, hours })
    .onConflictDoUpdate({ target: [memberCapacity.organizationId, memberCapacity.userId], set: { hours, updatedAt: new Date() } });
  await audit(conn, organizationId, actorId, "CAPACITY_UPDATED", userId, { hours, weekly: hours.reduce((a, b) => a + b, 0) });
  return hours;
}

export async function addTimeOff(
  conn: DB,
  actorId: string,
  organizationId: string,
  raw: { userId: string | null; kind?: string; startDate: string; endDate: string; note?: string | null }
) {
  const input = z
    .object({
      userId: z.string().uuid().nullable(),
      kind: z.enum(["vacation", "sick", "holiday", "other"]).default("vacation"),
      startDate: dateStr,
      endDate: dateStr,
      note: z.string().trim().max(120).nullish(),
    })
    .parse(raw);
  if (input.startDate > input.endDate) throw new AppError("VALIDATION", "Time off must end on or after it starts");
  if (input.userId === null && input.kind !== "holiday") input.kind = "holiday";
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  if (input.userId) await assertMember(conn, organizationId, input.userId);
  const [row] = await conn
    .insert(timeOff)
    .values({ organizationId, ...input, note: input.note ?? null, createdById: actorId })
    .returning();
  await audit(conn, organizationId, actorId, "TIME_OFF_ADDED", row!.id, { userId: input.userId, kind: input.kind, startDate: input.startDate, endDate: input.endDate });
  return row!;
}

export async function deleteTimeOff(conn: DB, actorId: string, organizationId: string, id: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [row] = await conn.delete(timeOff).where(and(eq(timeOff.id, id), eq(timeOff.organizationId, organizationId))).returning();
  if (!row) throw new AppError("NOT_FOUND", "Time off not found");
  await audit(conn, organizationId, actorId, "TIME_OFF_REMOVED", id, { userId: row.userId, kind: row.kind });
  return row;
}

/* -------------------------------- computation ------------------------------- */

export type LoadItem = { taskId: string; ref: string; title: string; projectKey: string; hours: number; overdue: boolean };
export type DayCell = { day: string; capacity: number; load: number; off: TimeOff["kind"] | null; items: LoadItem[] };
export type CapacityStatus = "ok" | "near" | "over" | "idle";
export type PersonWorkload = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  hours: WeekHours;
  customized: boolean;
  days: DayCell[];
  totalCapacity: number;
  totalLoad: number;
  status: CapacityStatus;
  overDays: number;
  unestimated: number;
  unscheduled: number;
};

export function statusFor(load: number, capacity: number, nearThreshold: number): CapacityStatus {
  if (load <= 0) return "idle";
  if (capacity <= 0) return "over"; // work scheduled on a non-working day
  if (load > capacity + 1e-9) return "over";
  if (load >= (capacity * nearThreshold) / 100) return "near";
  return "ok";
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Pure core: given schedule, time off and tasks, compute per-person per-day load. */
export function computeLoad(input: {
  from: string;
  to: string;
  today: string;
  people: { userId: string; name: string; avatarUrl: string | null }[];
  settings: CapacitySettings;
  timeOff: Pick<TimeOff, "userId" | "kind" | "startDate" | "endDate">[];
  tasks: {
    id: string;
    ref: string;
    title: string;
    projectKey: string;
    estimateHours: number | null;
    startDate: string | null;
    dueDate: string | null;
    assignees: string[];
  }[];
}): PersonWorkload[] {
  const { from, to, today, settings } = input;
  const window = daysBetween(from, to);
  const offFor = (userId: string, day: string) =>
    input.timeOff.find((o) => (o.userId === null || o.userId === userId) && o.startDate <= day && day <= o.endDate)?.kind ?? null;
  const hoursOf = (userId: string) => settings.overrides[userId] ?? settings.defaultHours;
  const capacity = (userId: string, day: string) => (offFor(userId, day) ? 0 : hoursOf(userId)[weekday(day)]!);

  const byUser = new Map<string, PersonWorkload>();
  for (const p of input.people) {
    byUser.set(p.userId, {
      ...p,
      hours: hoursOf(p.userId),
      customized: !!settings.overrides[p.userId],
      days: window.map((day) => ({ day, capacity: capacity(p.userId, day), load: 0, off: offFor(p.userId, day), items: [] })),
      totalCapacity: 0,
      totalLoad: 0,
      status: "idle",
      overDays: 0,
      unestimated: 0,
      unscheduled: 0,
    });
  }

  for (const t of input.tasks) {
    // Split across ALL assignees (even ones not being computed), then place only the shares we track.
    const everyone = [...new Set(t.assignees)];
    const assignees = everyone.filter((u) => byUser.has(u));
    if (!assignees.length) continue;
    if (!t.estimateHours || t.estimateHours <= 0) {
      for (const u of assignees) byUser.get(u)!.unestimated++;
      continue;
    }
    const start = t.startDate ?? t.dueDate;
    const end = t.dueDate ?? t.startDate;
    if (!start || !end) {
      for (const u of assignees) byUser.get(u)!.unscheduled++;
      continue;
    }
    const share = t.estimateHours / everyone.length; // split evenly between all assignees
    for (const u of assignees) {
      const person = byUser.get(u)!;
      let placements: { day: string; hours: number; overdue: boolean }[];
      if (end < today) {
        placements = [{ day: today, hours: share, overdue: true }]; // overdue work piles onto today
      } else {
        const effStart = start < today ? today : start;
        const working = daysBetween(effStart, end).filter((d) => capacity(u, d) > 0);
        placements = working.length
          ? working.map((d) => ({ day: d, hours: share / working.length, overdue: false }))
          : [{ day: end, hours: share, overdue: false }]; // only non-working days: shows as over on that day
      }
      for (const pl of placements) {
        const cell = person.days.find((c) => c.day === pl.day);
        if (!cell) continue;
        cell.load += pl.hours;
        cell.items.push({ taskId: t.id, ref: t.ref, title: t.title, projectKey: t.projectKey, hours: r1(pl.hours), overdue: pl.overdue });
      }
    }
  }

  for (const p of byUser.values()) {
    for (const c of p.days) c.load = r1(c.load);
    p.totalCapacity = r1(p.days.reduce((s, c) => s + c.capacity, 0));
    p.totalLoad = r1(p.days.reduce((s, c) => s + c.load, 0));
    p.overDays = p.days.filter((c) => statusFor(c.load, c.capacity, settings.nearThreshold) === "over").length;
    // Per-day first: one 12h day is "over" even if the week total fits.
    p.status = p.overDays ? "over" : statusFor(p.totalLoad, p.totalCapacity, settings.nearThreshold);
  }
  return [...byUser.values()];
}

/** Load the data for a window and compute workload for some or all members. */
export async function workloadFor(conn: DbOrTx, organizationId: string, window: { from: string; to: string }, userIds?: string[], today = utcToday()) {
  const settings = await loadSettings(conn, organizationId);
  const people = await conn
    .select({ userId: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.organizationId, organizationId), userIds?.length ? inArray(orgMembers.userId, userIds) : sql`true`));

  const offs = await conn
    .select()
    .from(timeOff)
    .where(and(eq(timeOff.organizationId, organizationId), lte(timeOff.startDate, window.to), gte(timeOff.endDate, window.from)));

  // "Done" = the last status of each project.
  const doneCols = await conn
    .selectDistinctOn([boardColumns.projectId], { projectId: boardColumns.projectId, id: boardColumns.id })
    .from(boardColumns)
    .where(eq(boardColumns.organizationId, organizationId))
    .orderBy(boardColumns.projectId, desc(boardColumns.position));
  const doneIds = doneCols.map((c) => c.id);

  const ids = people.map((p) => p.userId);
  const co = ids.length
    ? await conn
        .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(and(eq(taskAssignees.organizationId, organizationId), inArray(taskAssignees.userId, ids)))
    : [];
  const coTaskIds = [...new Set(co.map((c) => c.taskId))];

  const rows = ids.length
    ? await conn
        .select({ task: tasks, projectKey: projects.key })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(
          and(
            eq(tasks.organizationId, organizationId),
            doneIds.length ? sql`${tasks.columnId} not in (${sql.join(doneIds.map((d) => sql`${d}`), sql`, `)})` : sql`true`,
            or(inArray(tasks.assigneeId, ids), coTaskIds.length ? inArray(tasks.id, coTaskIds) : sql`false`)
          )
        )
    : [];
  // Co-assignees for these tasks (including people outside `userIds`, so the split stays fair).
  const taskIds = rows.map((r) => r.task.id);
  const allCo = taskIds.length
    ? await conn.select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId }).from(taskAssignees).where(inArray(taskAssignees.taskId, taskIds))
    : [];
  const coBy = new Map<string, string[]>();
  for (const c of allCo) coBy.set(c.taskId, [...(coBy.get(c.taskId) ?? []), c.userId]);

  const computed = computeLoad({
    from: window.from,
    to: window.to,
    today,
    people,
    settings,
    timeOff: offs,
    tasks: rows.map(({ task, projectKey }) => ({
      id: task.id,
      ref: `${projectKey}-${task.taskNumber}`,
      title: task.title,
      projectKey,
      estimateHours: task.estimateHours,
      startDate: task.startDate,
      dueDate: task.dueDate,
      assignees: [...(task.assigneeId ? [task.assigneeId] : []), ...(coBy.get(task.id) ?? [])],
    })),
  });
  return { settings, people: computed, timeOff: offs };
}

export async function getWorkload(conn: DB, actorId: string, organizationId: string, raw: { from: string; to: string; today?: string | null }) {
  const window = z.object({ from: dateStr, to: dateStr }).parse({ from: raw.from, to: raw.to });
  if (window.from > window.to) throw new AppError("VALIDATION", "Invalid range");
  if ((toDate(window.to).getTime() - toDate(window.from).getTime()) / DAY > 62) throw new AppError("VALIDATION", "Pick a range of at most 9 weeks");
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return workloadFor(conn, organizationId, window, undefined, resolveToday(raw.today));
}

/* --------------------------------- warnings -------------------------------- */

export type CapacityWarning = {
  userId: string;
  name: string;
  level: "near" | "over";
  /** Days in the window where this person is over capacity. */
  overDays: { day: string; load: number; capacity: number }[];
  weekLoad: number;
  weekCapacity: number;
};

/**
 * Warnings for the given people over the window a task occupies (or this week if
 * it has no dates). Purely advisory: the assignment has already happened.
 */
export async function capacityWarnings(
  conn: DbOrTx,
  organizationId: string,
  userIds: string[],
  task: { startDate: string | null; dueDate: string | null },
  clientToday?: string | null
): Promise<CapacityWarning[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const today = resolveToday(clientToday);
  const start = task.startDate ?? task.dueDate;
  const end = task.dueDate ?? task.startDate;
  let from: string;
  let to: string;
  if (!start || !end) ({ from, to } = weekOf(today));
  else {
    from = end < today ? today : start < today ? today : start;
    to = end < today ? today : end;
  }
  // Always include the full calendar week(s) around the window for the weekly totals.
  const wFrom = weekOf(from).from;
  const wTo = weekOf(to).to;
  const { people, settings } = await workloadFor(conn, organizationId, { from: wFrom, to: wTo }, ids, today);
  const out: CapacityWarning[] = [];
  for (const p of people) {
    const inWindow = p.days.filter((d) => d.day >= from && d.day <= to);
    const overDays = inWindow
      .filter((d) => statusFor(d.load, d.capacity, settings.nearThreshold) === "over")
      .map((d) => ({ day: d.day, load: d.load, capacity: d.capacity }));
    const week = p.days.filter((d) => d.day >= weekOf(from).from && d.day <= weekOf(from).to);
    const weekLoad = r1(week.reduce((s, d) => s + d.load, 0));
    const weekCapacity = r1(week.reduce((s, d) => s + d.capacity, 0));
    const near = statusFor(weekLoad, weekCapacity, settings.nearThreshold) === "near";
    if (overDays.length || near) out.push({ userId: p.userId, name: p.name, level: overDays.length ? "over" : "near", overDays, weekLoad, weekCapacity });
  }
  return out;
}

/** Time off listing for a window (workspace holidays have userId null). */
export async function listTimeOff(conn: DB, actorId: string, organizationId: string, raw: { from: string; to: string }) {
  const window = z.object({ from: dateStr, to: dateStr }).parse(raw);
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn
    .select()
    .from(timeOff)
    .where(and(eq(timeOff.organizationId, organizationId), lte(timeOff.startDate, window.to), gte(timeOff.endDate, window.from)));
}

