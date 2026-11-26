import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import {
  auditLogs,
  boardColumns,
  checklistItems,
  projects,
  taskAssignees,
  taskRecurrences,
  taskTags,
  taskWatchers,
  tasks,
  type RecurrenceFrequency,
  type Task,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/fractional-index";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Recurring tasks (ClickUp/Asana "repeat when done"): when a recurring task reaches
 * its project's Done status, the next occurrence is created in the first status with
 * dates moved forward, and the rule moves to the new task. Because the rule moves,
 * re-opening and re-completing the old task never creates a duplicate.
 */

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

/** Advance a date-only string by one recurrence step. Monthly keeps the day, clamped (Jan 31 → Feb 28/29). */
export function advanceDate(iso: string, frequency: RecurrenceFrequency, interval: number): string {
  const d = toDate(iso);
  switch (frequency) {
    case "daily":
      return toIso(new Date(d.getTime() + interval * DAY));
    case "weekly":
      return toIso(new Date(d.getTime() + 7 * interval * DAY));
    case "weekdays": {
      let left = interval;
      let cur = d;
      while (left > 0) {
        cur = new Date(cur.getTime() + DAY);
        const wd = cur.getUTCDay();
        if (wd !== 0 && wd !== 6) left--;
      }
      return toIso(cur);
    }
    case "monthly": {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + interval;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      return toIso(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last))));
    }
  }
}

/** Dates for the next occurrence: the due date moves one step, the start keeps its distance to it. */
export function nextDates(task: { startDate: string | null; dueDate: string | null }, rule: { frequency: RecurrenceFrequency; interval: number }, today: string) {
  const anchor = task.dueDate ?? task.startDate ?? today;
  let next = advanceDate(anchor, rule.frequency, rule.interval);
  // Completed very late? Skip ahead so the next occurrence isn't already overdue.
  for (let i = 0; next < today && i < 400; i++) next = advanceDate(next, rule.frequency, rule.interval);
  if (task.dueDate && task.startDate) {
    const gap = Math.round((toDate(task.dueDate).getTime() - toDate(task.startDate).getTime()) / DAY);
    return { startDate: toIso(new Date(toDate(next).getTime() - gap * DAY)), dueDate: next };
  }
  if (task.startDate && !task.dueDate) return { startDate: next, dueDate: null };
  return { startDate: null, dueDate: next };
}

export const recurrenceInput = z
  .object({ frequency: z.enum(["daily", "weekdays", "weekly", "monthly"]), interval: z.number().int().min(1).max(12).default(1) })
  .nullable();

export async function setRecurrence(conn: DB, actorId: string, organizationId: string, taskId: string, raw: z.input<typeof recurrenceInput>) {
  const rule = recurrenceInput.parse(raw);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [t] = await tx.select({ id: tasks.id, projectId: tasks.projectId }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId))).limit(1);
    if (!t) throw new AppError("NOT_FOUND", "Task not found");
    if (!rule) {
      await tx.delete(taskRecurrences).where(eq(taskRecurrences.taskId, taskId));
    } else {
      await tx
        .insert(taskRecurrences)
        .values({ taskId, organizationId, frequency: rule.frequency, interval: rule.interval, createdById: actorId })
        .onConflictDoUpdate({ target: taskRecurrences.taskId, set: { frequency: rule.frequency, interval: rule.interval } });
    }
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: "RECURRENCE_SET", entityType: "task", entityId: taskId, metadata: rule ? { ...rule } : { removed: true },
    });
    return { projectId: t.projectId };
  });
}

/** Called inside the transaction that moved `task` into Done. Returns the new occurrence, if any. */
export async function spawnNextOccurrence(tx: DbOrTx, organizationId: string, actorId: string, task: Task, today: string): Promise<Task | null> {
  const [rule] = await tx.select().from(taskRecurrences).where(eq(taskRecurrences.taskId, task.id)).limit(1);
  if (!rule) return null;
  const [first] = await tx
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(eq(boardColumns.projectId, task.projectId))
    .orderBy(asc(boardColumns.position))
    .limit(1);
  if (!first) return null;
  const [project] = await tx
    .update(projects)
    .set({ taskCounter: sql`${projects.taskCounter} + 1` })
    .where(eq(projects.id, task.projectId))
    .returning({ taskCounter: projects.taskCounter, key: projects.key });
  const [last] = await tx.select({ position: tasks.position }).from(tasks).where(eq(tasks.columnId, first.id)).orderBy(desc(tasks.position)).limit(1);
  const dates = nextDates(task, rule, today);
  const [next] = await tx
    .insert(tasks)
    .values({
      organizationId,
      projectId: task.projectId,
      columnId: first.id,
      taskNumber: project!.taskCounter,
      title: task.title,
      description: task.description,
      priority: task.priority,
      assigneeId: task.assigneeId,
      startDate: dates.startDate,
      dueDate: dates.dueDate,
      storyPoints: task.storyPoints,
      estimateHours: task.estimateHours,
      parentId: task.parentId,
      type: task.type,
      sprintId: null,
      position: (last?.position ?? 0) + POSITION_STEP,
    })
    .returning();

  // Carry over the people, labels and an unchecked copy of the checklist.
  const [co, watch, tg, items] = await Promise.all([
    tx.select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, task.id)),
    tx.select({ userId: taskWatchers.userId }).from(taskWatchers).where(eq(taskWatchers.taskId, task.id)),
    tx.select({ tagId: taskTags.tagId }).from(taskTags).where(eq(taskTags.taskId, task.id)),
    tx.select({ text: checklistItems.text, position: checklistItems.position }).from(checklistItems).where(eq(checklistItems.taskId, task.id)),
  ]);
  if (co.length) await tx.insert(taskAssignees).values(co.map((c) => ({ organizationId, taskId: next!.id, userId: c.userId })));
  if (watch.length) await tx.insert(taskWatchers).values(watch.map((w) => ({ organizationId, taskId: next!.id, userId: w.userId })));
  if (tg.length) await tx.insert(taskTags).values(tg.map((t) => ({ organizationId, taskId: next!.id, tagId: t.tagId })));
  if (items.length) await tx.insert(checklistItems).values(items.map((i) => ({ organizationId, taskId: next!.id, text: i.text, position: i.position, done: false })));

  await tx.update(taskRecurrences).set({ taskId: next!.id, occurrences: sql`${taskRecurrences.occurrences} + 1` }).where(eq(taskRecurrences.taskId, task.id));
  await tx.insert(auditLogs).values({
    organizationId,
    actorId,
    action: "TASK_CREATED",
    entityType: "task",
    entityId: next!.id,
    metadata: { ref: `${project!.key}-${next!.taskNumber}`, title: next!.title, columnId: first.id, recurringFrom: task.id },
  });
  return next!;
}
