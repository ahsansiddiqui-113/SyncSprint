"use server";

import { db } from "@/db";
import type { ProjectStatus } from "@/db/schema";
import { toResult } from "@/lib/errors";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { requireActor } from "@/lib/session";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { publishEffects } from "@/server/after-task-change";
import { publishTask } from "@/server/public-events";
import { newEffects } from "@/server/services/task-effects";
import * as baselines from "@/server/services/baselines";
import * as portfolio from "@/server/services/portfolio";
import * as wb from "@/server/services/whiteboards";

/** Phase 8: baselines, portfolio status updates, whiteboards and mind maps. Actor always from the session. */

/* --------------------------------- baselines --------------------------------- */

export async function listBaselinesAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await baselines.listBaselines(db, actor.id, organizationId, projectId);
    return { baselines: rows.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })) };
  });
}

export async function getBaselineAction(organizationId: string, baselineId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const b = await baselines.getBaseline(db, actor.id, organizationId, baselineId);
    return { baseline: { ...b, createdAt: b.createdAt.toISOString() } };
  });
}

export async function createBaselineAction(organizationId: string, projectId: string, name: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const b = await baselines.createBaseline(db, actor.id, organizationId, projectId, name);
    broadcastOrgEvent(organizationId, { type: "PLANNING_CHANGED", actor, projectId });
    return { baseline: { ...b, createdAt: b.createdAt.toISOString() } };
  });
}

export async function deleteBaselineAction(organizationId: string, projectId: string, baselineId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await baselines.deleteBaseline(db, actor.id, organizationId, baselineId);
    broadcastOrgEvent(organizationId, { type: "PLANNING_CHANGED", actor, projectId });
    return {};
  });
}

/* --------------------------------- portfolio --------------------------------- */

export async function getPortfolioAction(organizationId: string, today?: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return await portfolio.getPortfolio(db, actor.id, organizationId, today);
  });
}

export async function setProjectStatusAction(organizationId: string, projectId: string, status: ProjectStatus, note: string | null) {
  return toResult(async () => {
    const actor = await requireActor();
    await portfolio.setProjectStatus(db, actor.id, organizationId, projectId, { status, note });
    broadcastOrgEvent(organizationId, { type: "PLANNING_CHANGED", actor, projectId });
    return {};
  });
}

/* -------------------------------- whiteboards -------------------------------- */

const iso = <T extends { updatedAt: Date }>(b: T) => ({ ...b, updatedAt: b.updatedAt.toISOString() });

export async function listBoardsAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { boards: (await wb.listBoards(db, actor.id, organizationId, projectId)).map(iso) };
  });
}

export async function createBoardAction(organizationId: string, projectId: string, name: string, kind: "whiteboard" | "mindmap") {
  return toResult(async () => {
    const actor = await requireActor();
    const b = await wb.createBoard(db, actor.id, organizationId, projectId, { name, kind });
    broadcastOrgEvent(organizationId, { type: "WHITEBOARD_CHANGED", actor, projectId, boardId: b.id, revision: b.revision });
    return { id: b.id };
  });
}

export async function renameBoardAction(organizationId: string, boardId: string, name: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const b = await wb.renameBoard(db, actor.id, organizationId, boardId, name);
    broadcastOrgEvent(organizationId, { type: "WHITEBOARD_CHANGED", actor, projectId: b.projectId, boardId, revision: b.revision });
    return {};
  });
}

export async function deleteBoardAction(organizationId: string, boardId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId } = await wb.deleteBoard(db, actor.id, organizationId, boardId);
    broadcastOrgEvent(organizationId, { type: "WHITEBOARD_CHANGED", actor, projectId, boardId, revision: null });
    return {};
  });
}

export async function getBoardAction(organizationId: string, boardId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { board, items, tasks } = await wb.getBoard(db, actor.id, organizationId, boardId);
    return {
      board: { id: board.id, projectId: board.projectId, name: board.name, kind: board.kind, revision: board.revision, createdById: board.createdById },
      items: items.map(toItemDTO),
      tasks,
    };
  });
}

export async function applyBoardOpsAction(organizationId: string, boardId: string, ops: wb.BoardOp[]) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await wb.applyBoardOps(db, actor.id, organizationId, boardId, ops);
    broadcastOrgEvent(organizationId, { type: "WHITEBOARD_CHANGED", actor, projectId: r.projectId, boardId, revision: r.revision });
    return { revision: r.revision, changed: r.changed.map(toItemDTO), deleted: r.deleted, conflicts: r.conflicts.map(toItemDTO) };
  });
}

export async function convertItemToTaskAction(organizationId: string, itemId: string, today?: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const fx = newEffects(today);
    const r = await wb.convertItemToTask(db, actor.id, organizationId, itemId, fx);
    broadcastOrgEvent(organizationId, { type: "TASK_CREATED", actor, task: toTaskDTO(r.task) });
    publishTask(organizationId, "task.created", r.task);
    publishEffects(organizationId, actor, r.projectId, fx);
    broadcastOrgEvent(organizationId, { type: "WHITEBOARD_CHANGED", actor, projectId: r.projectId, boardId: r.boardId, revision: null });
    return { taskId: r.task.id };
  });
}

export async function mindmapToTasksAction(organizationId: string, nodeId: string, today?: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const fx = newEffects(today);
    const r = await wb.mindmapBranchToTasks(db, actor.id, organizationId, nodeId, fx);
    for (const t of r.created) {
      broadcastOrgEvent(organizationId, { type: "TASK_CREATED", actor, task: toTaskDTO(t) });
      publishTask(organizationId, "task.created", t);
    }
    publishEffects(organizationId, actor, r.projectId, fx);
    broadcastOrgEvent(organizationId, { type: "WHITEBOARD_CHANGED", actor, projectId: r.projectId, boardId: r.boardId, revision: null });
    return { created: r.created.length };
  });
}

export type BoardItemDTO = ReturnType<typeof toItemDTO>;
function toItemDTO(i: Awaited<ReturnType<typeof wb.getBoard>>["items"][number]) {
  return {
    id: i.id, kind: i.kind, x: i.x, y: i.y, w: i.w, h: i.h, text: i.text, color: i.color,
    fromId: i.fromId, toId: i.toId, parentId: i.parentId, taskId: i.taskId, z: i.z, collapsed: i.collapsed, version: i.version,
  };
}
