import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { organizations, projects, reminders, tasks } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { notify } from "./notifications";

/**
 * Personal reminders on a task ("remind me tomorrow at 9"). Anyone who can see the task
 * can set one for themselves; they arrive as an inbox notification (and push/email when on).
 */

const MAX_OPEN = 50;

export async function listMyReminders(conn: DB, actorId: string, organizationId: string, taskId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn
    .select({ id: reminders.id, remindAt: reminders.remindAt, note: reminders.note, sentAt: reminders.sentAt })
    .from(reminders)
    .where(and(eq(reminders.organizationId, organizationId), eq(reminders.userId, actorId), eq(reminders.taskId, taskId)))
    .orderBy(asc(reminders.remindAt));
}

export async function setReminder(conn: DB, actorId: string, organizationId: string, taskId: string, raw: { remindAt: string; note?: string | null }, now = new Date()) {
  const input = z.object({ remindAt: z.string().datetime({ offset: true }), note: z.string().trim().max(300).nullish() }).parse(raw);
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const at = new Date(input.remindAt);
  if (at.getTime() < now.getTime() - 60_000) throw new AppError("VALIDATION", "Pick a time in the future");
  if (at.getTime() > now.getTime() + 366 * 86_400_000) throw new AppError("VALIDATION", "Reminders can be up to a year ahead");
  const [t] = await conn.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId))).limit(1);
  if (!t) throw new AppError("NOT_FOUND", "Task not found");
  const [{ n }] = (await conn.select({ n: sql<number>`count(*)::int` }).from(reminders).where(and(eq(reminders.userId, actorId), isNull(reminders.sentAt)))) as [{ n: number }];
  if (n >= MAX_OPEN) throw new AppError("VALIDATION", `You can have up to ${MAX_OPEN} upcoming reminders`);
  const [r] = await conn.insert(reminders).values({ organizationId, userId: actorId, taskId, remindAt: at, note: input.note ?? null }).returning();
  return r!;
}

export async function deleteReminder(conn: DB, actorId: string, organizationId: string, reminderId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const gone = await conn.delete(reminders).where(and(eq(reminders.id, reminderId), eq(reminders.userId, actorId), eq(reminders.organizationId, organizationId))).returning({ id: reminders.id });
  if (!gone.length) throw new AppError("NOT_FOUND", "Reminder not found");
}

/** Scheduler: deliver reminders that are due. Each is claimed (sentAt) before notifying, so it fires once. */
export async function deliverDueReminders(conn: DB, now = new Date()) {
  const due = await conn
    .select({ r: reminders, title: tasks.title, number: tasks.taskNumber, key: projects.key, slug: organizations.slug })
    .from(reminders)
    .innerJoin(tasks, eq(tasks.id, reminders.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(organizations, eq(organizations.id, reminders.organizationId))
    .where(and(isNull(reminders.sentAt), lte(reminders.remindAt, now)))
    .orderBy(asc(reminders.remindAt))
    .limit(500);
  const out: { organizationId: string; userIds: string[] }[] = [];
  for (const d of due) {
    const claimed = await conn.update(reminders).set({ sentAt: now }).where(and(eq(reminders.id, d.r.id), isNull(reminders.sentAt))).returning({ id: reminders.id });
    if (!claimed.length) continue;
    const userIds = await notify(conn, d.r.organizationId, null, [{
      userId: d.r.userId, kind: "reminder", taskId: d.r.taskId,
      title: `Reminder: ${d.key}-${d.number} ${d.title}`.slice(0, 200), body: d.r.note,
      link: `/w/${d.slug}/projects/${d.key}?task=${d.r.taskId}`,
    }]);
    if (userIds.length) out.push({ organizationId: d.r.organizationId, userIds });
  }
  return out;
}
