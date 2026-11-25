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

/** Note: there is no `userId` in any payload — the actor always comes from the session. */

export async function createTaskAction(input: Parameters<typeof svc.createTask>[2]) {
  return toResult(async () => {
    const actor = await requireActor();
    const task = await svc.createTask(db, actor.id, input);
    const dto = toTaskDTO(task);
    broadcastOrgEvent(task.organizationId, { type: "TASK_CREATED", actor, task: dto });
    return { task: dto };
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

export async function updateTaskAction(input: Parameters<typeof svc.updateTask>[2]) {
  return toResult(async () => {
    const actor = await requireActor();
    const res = await svc.updateTask(db, actor.id, input);
    if (!res.ok) return { conflict: true as const, current: res.current ? toTaskDTO(res.current) : null };
    const task = toTaskDTO(res.task);
    broadcastOrgEvent(input.organizationId, { type: "TASK_UPDATED", actor, task, action: "edited", changes: res.changes });
    return { conflict: false as const, task };
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
