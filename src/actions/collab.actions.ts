"use server";

import { db } from "@/db";
import { AppError, toResult } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { requireActor } from "@/lib/session";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import * as notes from "@/server/services/notifications";
import * as time from "@/server/services/time-tracking";
import * as files from "@/server/services/attachments";
import * as docsSvc from "@/server/services/docs";
import * as goalsSvc from "@/server/services/goals";

type Actor = { id: string; name: string };

/* ------------------------------ notifications ------------------------------ */

export async function listNotificationsAction(organizationId: string, unreadOnly = false) {
  return toResult(async () => {
    const actor = await requireActor();
    const { items, unread } = await notes.listNotifications(db, actor.id, organizationId, { unreadOnly });
    return {
      unread,
      items: items.map((n) => ({ ...n, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })),
    };
  });
}

export async function markNotificationsReadAction(organizationId: string, ids: string[] = []) {
  return toResult(async () => {
    const actor = await requireActor();
    await notes.markRead(db, actor.id, organizationId, ids);
    return {};
  });
}

/* ------------------------------ time tracking ------------------------------ */

const timeChanged = (organizationId: string, actor: Actor, projectId: string, taskId: string) =>
  broadcastOrgEvent(organizationId, { type: "TIME_CHANGED", actor, projectId, taskId, userId: actor.id });

export async function startTimerAction(organizationId: string, taskId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await time.startTimer(db, actor.id, organizationId, taskId);
    timeChanged(organizationId, actor, r.projectId, taskId);
    if (r.stopped && r.stopped.organizationId === organizationId && r.stopped.taskId !== taskId) {
      timeChanged(organizationId, actor, r.projectId, r.stopped.taskId);
    }
    return { running: await time.runningTimer(db, actor.id, organizationId) };
  });
}

export async function stopTimerAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await time.stopTimer(db, actor.id, organizationId);
    timeChanged(organizationId, actor, r.projectId, r.entry.taskId);
    return { minutes: r.entry.minutes ?? 0, discarded: r.discarded };
  });
}

export async function runningTimerAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { running: await time.runningTimer(db, actor.id, organizationId) };
  });
}

export async function addTimeEntryAction(organizationId: string, input: { taskId: string; minutes: number; date: string; note?: string | null }) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await time.addManualEntry(db, actor.id, organizationId, input);
    timeChanged(organizationId, actor, r.projectId, input.taskId);
    return {};
  });
}

export async function deleteTimeEntryAction(organizationId: string, taskId: string, entryId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await time.deleteEntry(db, actor.id, organizationId, entryId);
    timeChanged(organizationId, actor, r.projectId, taskId);
    return {};
  });
}

export async function taskTimeAction(organizationId: string, taskId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await time.listTaskTime(db, actor.id, organizationId, taskId);
    return {
      entries: rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null })),
      running: await time.runningTimer(db, actor.id, organizationId),
    };
  });
}

export async function trackedMinutesAction(organizationId: string, taskIds: string[]) {
  return toResult(async () => {
    const actor = await requireActor();
    await requireOrgPermission(actor.id, organizationId, "viewer");
    const ids = taskIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 2000);
    return { minutes: await time.trackedMinutesFor(db, organizationId, ids) };
  });
}

/* -------------------------------- attachments ------------------------------- */

export async function listAttachmentsAction(organizationId: string, taskId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await files.listAttachments(db, actor.id, organizationId, taskId);
    return { attachments: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  });
}

export async function deleteAttachmentAction(organizationId: string, attachmentId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await files.deleteAttachment(db, actor.id, organizationId, attachmentId);
    broadcastOrgEvent(organizationId, { type: "ATTACHMENTS_CHANGED", actor, projectId: r.projectId, taskId: r.taskId });
    return {};
  });
}

/* ----------------------------------- docs ----------------------------------- */

export async function createDocAction(organizationId: string, title: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const d = await docsSvc.createDoc(db, actor.id, organizationId, { title });
    broadcastOrgEvent(organizationId, { type: "DOCS_CHANGED", actor, docId: d.id, version: d.version });
    return { id: d.id };
  });
}

export async function saveDocAction(organizationId: string, input: { docId: string; expectedVersion: number; title?: string; content?: string }) {
  return toResult(async () => {
    const actor = await requireActor();
    try {
      const d = await docsSvc.updateDoc(db, actor.id, organizationId, input);
      broadcastOrgEvent(organizationId, { type: "DOCS_CHANGED", actor, docId: d.id, version: d.version });
      return { conflict: false as const, version: d.version, updatedAt: d.updatedAt.toISOString() };
    } catch (err) {
      if (err instanceof AppError && err.code === "VERSION_CONFLICT") {
        const current = await docsSvc.getDoc(db, actor.id, organizationId, input.docId);
        return {
          conflict: true as const,
          current: { title: current.title, content: current.content, version: current.version, updatedByName: current.updatedByName },
        };
      }
      throw err;
    }
  });
}

export async function deleteDocAction(organizationId: string, docId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await docsSvc.deleteDoc(db, actor.id, organizationId, docId);
    broadcastOrgEvent(organizationId, { type: "DOCS_CHANGED", actor, docId, version: null });
    return {};
  });
}

export async function setDocTaskLinkAction(organizationId: string, docId: string, taskId: string, linked: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    await docsSvc.setDocTaskLink(db, actor.id, organizationId, docId, taskId, linked);
    broadcastOrgEvent(organizationId, { type: "DOCS_CHANGED", actor, docId, version: null });
    return {};
  });
}

export async function docsForTaskAction(organizationId: string, taskId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { docs: await docsSvc.docsForTask(db, actor.id, organizationId, taskId) };
  });
}

export async function searchTasksAction(organizationId: string, q: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { tasks: await docsSvc.searchTasks(db, actor.id, organizationId, q) };
  });
}

/* ----------------------------------- goals ---------------------------------- */

const goalsChanged = (organizationId: string, actor: Actor) => broadcastOrgEvent(organizationId, { type: "GOALS_CHANGED", actor });

export async function listGoalsAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { goals: await goalsSvc.listGoals(db, actor.id, organizationId) };
  });
}

export async function createGoalAction(organizationId: string, input: { title: string; description?: string | null; ownerId?: string | null; dueDate?: string | null }) {
  return toResult(async () => {
    const actor = await requireActor();
    const g = await goalsSvc.createGoal(db, actor.id, organizationId, input);
    goalsChanged(organizationId, actor);
    return { id: g.id };
  });
}

export async function updateGoalAction(
  organizationId: string,
  goalId: string,
  input: { title?: string; description?: string | null; ownerId?: string | null; dueDate?: string | null }
) {
  return toResult(async () => {
    const actor = await requireActor();
    await goalsSvc.updateGoal(db, actor.id, organizationId, goalId, input);
    goalsChanged(organizationId, actor);
    return {};
  });
}

export async function deleteGoalAction(organizationId: string, goalId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await goalsSvc.deleteGoal(db, actor.id, organizationId, goalId);
    goalsChanged(organizationId, actor);
    return {};
  });
}

export async function addKeyResultAction(
  organizationId: string,
  goalId: string,
  input: { title: string; kind: "number" | "tasks"; startValue?: number; targetValue?: number; currentValue?: number; unit?: string | null }
) {
  return toResult(async () => {
    const actor = await requireActor();
    await goalsSvc.addKeyResult(db, actor.id, organizationId, goalId, input);
    goalsChanged(organizationId, actor);
    return {};
  });
}

export async function updateKeyResultValueAction(organizationId: string, keyResultId: string, value: number) {
  return toResult(async () => {
    const actor = await requireActor();
    await goalsSvc.updateKeyResultValue(db, actor.id, organizationId, keyResultId, value);
    goalsChanged(organizationId, actor);
    return {};
  });
}

export async function deleteKeyResultAction(organizationId: string, keyResultId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await goalsSvc.deleteKeyResult(db, actor.id, organizationId, keyResultId);
    goalsChanged(organizationId, actor);
    return {};
  });
}

export async function setKeyResultTaskAction(organizationId: string, keyResultId: string, taskId: string, linked: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    await goalsSvc.setKeyResultTaskLink(db, actor.id, organizationId, keyResultId, taskId, linked);
    goalsChanged(organizationId, actor);
    return {};
  });
}
