import { desc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { boardColumns, type Task } from "@/db/schema";
import { runAutomations } from "./automations";
import { notifyAssigned, notifyCompleted } from "./notifications";
import { spawnNextOccurrence } from "./recurrence";
import { recordSprintSnapshots } from "./sprints";

/**
 * Side effects collected while a task change is applied, for the caller to publish
 * after commit (inbox pings, extra TASK_CREATED events for recurring occurrences).
 */
export type Effects = { today: string; notified: Set<string>; created: Task[]; commented: Set<string>; tagged: Set<string> };

export function newEffects(today?: string | null): Effects {
  const utc = new Date().toISOString().slice(0, 10);
  // Accept the viewer's local "today" only within a day of UTC (same rule as capacity).
  const ok = today && /^\d{4}-\d{2}-\d{2}$/.test(today) && Math.abs(Date.parse(today) - Date.parse(utc)) <= 86_400_000;
  return { today: ok ? today! : utc, notified: new Set(), created: [], commented: new Set(), tagged: new Set() };
}

/**
 * Everything that follows a task being created, moved or edited, in order, inside
 * the same transaction:
 *   1. automations (their own changes don't re-trigger automations)
 *   2. "assigned to you" for a new assignee (including one an automation set)
 *   3. entering Done: "completed" for assignees/watchers and the next recurring occurrence
 */
export async function afterTaskChange(tx: DbOrTx, organizationId: string, actorId: string, before: Task | null, task: Task, fx: Effects): Promise<Task> {
  const final = await runAutomations(tx, organizationId, actorId, { before, task }, fx);
  const add = (ids: string[]) => ids.forEach((u) => fx.notified.add(u));

  if (final.assigneeId && final.assigneeId !== (before?.assigneeId ?? null)) {
    add(await notifyAssigned(tx, organizationId, actorId, final.id, [final.assigneeId]));
  }

  if (before && before.columnId !== final.columnId) {
    const [last] = await tx
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, final.projectId))
      .orderBy(desc(boardColumns.position))
      .limit(1);
    if (last?.id === final.columnId && before.columnId !== last.id) {
      add(await notifyCompleted(tx, organizationId, actorId, final.id));
      const next = await spawnNextOccurrence(tx, organizationId, actorId, final, fx.today);
      if (next) fx.created.push(next);
    }
  }

  if (final !== task) await recordSprintSnapshots(tx, organizationId, [final.sprintId]);
  return final;
}
