"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { requireOrgPermission } from "@/lib/rbac";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import * as svc from "@/server/services/tasks";
import { capacityWarnings, type CapacityWarning } from "@/server/services/capacity";
import { taskAssignees } from "@/db/schema";

/**
 * Advisory only: the change is already saved. Computed for everyone assigned to
 * the task over the dates it occupies (or this week when it has none).
 */
async function warningsForTask(organizationId: string, task: { id: string; assigneeId: string | null; startDate: string | null; dueDate: string | null }, today?: string): Promise<CapacityWarning[]> {
  const co = await db.select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, task.id));
  const people = [...(task.assigneeId ? [task.assigneeId] : []), ...co.map((c) => c.userId)];
  if (!people.length) return [];
  try {
    return await capacityWarnings(db, organizationId, people, task, today);
  } catch (err) {
    console.error("[capacity] warning check failed", err); // never let advice break a save
    return [];
  }
}

const CAPACITY_FIELDS = ["assigneeId", "estimateHours", "startDate", "dueDate"];

/** Note: there is no `userId` in any payload — the actor always comes from the session. */

export async function createTaskAction(input: Parameters<typeof svc.createTask>[2], today?: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const task = await svc.createTask(db, actor.id, input);
    const dto = toTaskDTO(task);
    broadcastOrgEvent(task.organizationId, { type: "TASK_CREATED", actor, task: dto });
    const warnings = task.assigneeId && task.estimateHours ? await warningsForTask(task.organizationId, task, today) : [];
    return { task: dto, warnings };
  });
}

export async function moveTaskAction(input: {
  organizationId: string;
  taskId: string;
  targetColumnId: string;
  newPosition: number;
  expectedVersion: number;
}) {
  return toResult(async () => {
    const actor = await requireActor();
    const res = await svc.moveTask(db, actor.id, input);
    if (!res.ok) {
      return { conflict: true as const, current: res.current ? toTaskDTO(res.current) : null };
    }
    const task = toTaskDTO(res.task);
    // Broadcast only after commit, so peers never see state that could roll back.
    if (res.rebalanced) {
      broadcastOrgEvent(input.organizationId, { type: "COLUMN_REBALANCED", columnId: task.columnId, positions: res.rebalanced });
    }
    broadcastOrgEvent(input.organizationId, { type: "TASK_UPDATED", actor, task, action: "moved" });
    return { conflict: false as const, task, rebalanced: res.rebalanced };
  });
}

export async function updateTaskAction(input: Parameters<typeof svc.updateTask>[2], today?: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const res = await svc.updateTask(db, actor.id, input);
    if (!res.ok) return { conflict: true as const, current: res.current ? toTaskDTO(res.current) : null };
    const task = toTaskDTO(res.task);
    broadcastOrgEvent(input.organizationId, { type: "TASK_UPDATED", actor, task, action: "edited", changes: res.changes });
    const warnings = res.changes.some((c) => CAPACITY_FIELDS.includes(c)) ? await warningsForTask(input.organizationId, res.task, today) : [];
    return { conflict: false as const, task, warnings };
  });
}

export async function deleteTaskAction(organizationId: string, taskId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const deleted = await svc.deleteTask(db, actor.id, organizationId, taskId);
    broadcastOrgEvent(organizationId, { type: "TASK_DELETED", actor, taskId, projectId: deleted.projectId });
    return {};
  });
}

export async function addCommentAction(organizationId: string, taskId: string, body: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const c = await svc.addComment(db, actor.id, organizationId, taskId, body);
    broadcastOrgEvent(organizationId, { type: "COMMENT_ADDED", actor, taskId, commentId: c.id });
    return { comment: { id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), authorName: actor.name, authorId: actor.id } };
  });
}

export async function listCommentsAction(organizationId: string, taskId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await svc.listComments(db, actor.id, organizationId, taskId);
    return { comments: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  });
}


/** Authoritative snapshot used after a conflict or a WebSocket reconnect. */
export async function getBoardSnapshotAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await requireOrgPermission(actor.id, organizationId, "viewer");
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.projectId, projectId)));
    return { tasks: rows.map(toTaskDTO) };
  });
}

export async function projectFlowSeriesAction(organizationId: string, projectId: string, days: number) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectFlowSeries } = await import("@/server/services/workspace");
    return { series: await projectFlowSeries(db, actor.id, organizationId, projectId, days) };
  });
}
