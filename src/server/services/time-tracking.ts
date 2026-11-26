import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import { auditLogs, projects, tasks, timeEntries, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Time tracking: start/stop timer (one running per person, enforced by a partial
 * unique index) and manual entries. Starting a new timer stops the running one,
 * like ClickUp/Toggl. Entries are personal: only their author (or an admin) edits them.
 */

const MAX_MINUTES = 24 * 60;

async function taskInOrg(conn: DbOrTx, organizationId: string, taskId: string) {
  const [t] = await conn
    .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, taskNumber: tasks.taskNumber })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  if (!t) throw new AppError("NOT_FOUND", "Task not found");
  return t;
}

function minutesBetween(a: Date, b: Date) {
  return Math.max(0, Math.min(MAX_MINUTES, Math.round((b.getTime() - a.getTime()) / 60_000)));
}

/** Stop the actor's running timer (if any). Returns the stopped entry. */
async function stopRunning(conn: DbOrTx, organizationId: string, actorId: string, now = new Date()) {
  const [running] = await conn
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.organizationId, organizationId), eq(timeEntries.userId, actorId), isNull(timeEntries.endedAt)))
    .limit(1);
  if (!running) return null;
  const [stopped] = await conn
    .update(timeEntries)
    .set({ endedAt: now, minutes: minutesBetween(running.startedAt, now) })
    .where(eq(timeEntries.id, running.id))
    .returning();
  return stopped!;
}

export async function startTimer(conn: DB, actorId: string, organizationId: string, taskId: string) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const task = await taskInOrg(tx, organizationId, taskId);
    // A timer running in ANOTHER workspace also blocks (one per person); stop it too.
    const [elsewhere] = await tx.select().from(timeEntries).where(and(eq(timeEntries.userId, actorId), isNull(timeEntries.endedAt))).limit(1);
    let stopped = null;
    if (elsewhere) {
      const now = new Date();
      [stopped] = await tx
        .update(timeEntries)
        .set({ endedAt: now, minutes: minutesBetween(elsewhere.startedAt, now) })
        .where(eq(timeEntries.id, elsewhere.id))
        .returning();
      if (stopped && !stopped.minutes) await tx.delete(timeEntries).where(eq(timeEntries.id, stopped.id));
    }
    const [entry] = await tx.insert(timeEntries).values({ organizationId, taskId, userId: actorId, startedAt: new Date() }).returning();
    await tx.insert(auditLogs).values({ organizationId, actorId, action: "TIMER_STARTED", entityType: "task", entityId: taskId, metadata: { entryId: entry!.id } });
    return { entry: entry!, stopped, projectId: task.projectId };
  });
}

export async function stopTimer(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const stopped = await stopRunning(tx, organizationId, actorId);
    if (!stopped) throw new AppError("NOT_FOUND", "No timer is running");
    const task = await taskInOrg(tx, organizationId, stopped.taskId);
    // Accidental start/stop: under a minute is discarded rather than logged as "0m".
    if (!stopped.minutes) {
      await tx.delete(timeEntries).where(eq(timeEntries.id, stopped.id));
      return { entry: stopped, projectId: task.projectId, discarded: true };
    }
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: "TIME_LOGGED", entityType: "task", entityId: stopped.taskId, metadata: { minutes: stopped.minutes, via: "timer" },
    });
    return { entry: stopped, projectId: task.projectId, discarded: false };
  });
}

export async function addManualEntry(conn: DB, actorId: string, organizationId: string, raw: { taskId: string; minutes: number; date: string; note?: string | null }) {
  const input = z
    .object({
      taskId: z.string().uuid(),
      minutes: z.number().int().min(1).max(MAX_MINUTES),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: z.string().trim().max(200).nullish(),
    })
    .parse(raw);
  const start = new Date(`${input.date}T09:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new AppError("VALIDATION", "Invalid date");
  if (start.getTime() > Date.now() + 86_400_000) throw new AppError("VALIDATION", "Time can't be logged in the future");
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const task = await taskInOrg(tx, organizationId, input.taskId);
    const [entry] = await tx
      .insert(timeEntries)
      .values({
        organizationId, taskId: input.taskId, userId: actorId, startedAt: start,
        endedAt: new Date(start.getTime() + input.minutes * 60_000), minutes: input.minutes, note: input.note ?? null, manual: true,
      })
      .returning();
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: "TIME_LOGGED", entityType: "task", entityId: input.taskId, metadata: { minutes: input.minutes, via: "manual" },
    });
    return { entry: entry!, projectId: task.projectId };
  });
}

export async function deleteEntry(conn: DB, actorId: string, organizationId: string, entryId: string) {
  const role = await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [e] = await tx.select().from(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.organizationId, organizationId))).limit(1);
    if (!e) throw new AppError("NOT_FOUND", "Time entry not found");
    if (e.userId !== actorId && role !== "owner" && role !== "admin") throw new AppError("FORBIDDEN", "You can only delete your own time");
    await tx.delete(timeEntries).where(eq(timeEntries.id, entryId));
    const task = await taskInOrg(tx, organizationId, e.taskId);
    return { projectId: task.projectId };
  });
}

export async function listTaskTime(conn: DB, actorId: string, organizationId: string, taskId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  await taskInOrg(conn, organizationId, taskId);
  return conn
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      userName: users.name,
      startedAt: timeEntries.startedAt,
      endedAt: timeEntries.endedAt,
      minutes: timeEntries.minutes,
      note: timeEntries.note,
      manual: timeEntries.manual,
    })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(and(eq(timeEntries.organizationId, organizationId), eq(timeEntries.taskId, taskId)))
    .orderBy(desc(timeEntries.startedAt))
    .limit(100);
}

/** The actor's running timer in this workspace (for the header pill). */
export async function runningTimer(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const [row] = await conn
    .select({ id: timeEntries.id, taskId: timeEntries.taskId, startedAt: timeEntries.startedAt, title: tasks.title, taskNumber: tasks.taskNumber, key: projects.key })
    .from(timeEntries)
    .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(timeEntries.organizationId, organizationId), eq(timeEntries.userId, actorId), isNull(timeEntries.endedAt)))
    .limit(1);
  return row ? { id: row.id, taskId: row.taskId, startedAt: row.startedAt.toISOString(), ref: `${row.key}-${row.taskNumber}`, title: row.title, projectKey: row.key } : null;
}

/** Logged minutes per task (finished entries + running time so far), for cards and rows. */
export async function trackedMinutesFor(conn: DbOrTx, organizationId: string, taskIds: string[]) {
  if (!taskIds.length) return {} as Record<string, number>;
  const rows = await conn
    .select({
      taskId: timeEntries.taskId,
      minutes: sql<number>`coalesce(sum(coalesce(${timeEntries.minutes}, least(1440, round(extract(epoch from (now() - ${timeEntries.startedAt})) / 60)))), 0)::int`,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.organizationId, organizationId), inArray(timeEntries.taskId, taskIds)))
    .groupBy(timeEntries.taskId);
  return Object.fromEntries(rows.map((r) => [r.taskId, r.minutes]));
}
