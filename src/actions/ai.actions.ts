"use server";

import { db } from "@/db";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import * as ai from "@/server/ai/features";

export async function decomposeTaskAction(organizationId: string, taskId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await ai.decomposeTask(db, actor.id, organizationId, taskId);
    return { subtasks: r.data.subtasks, provider: r.provider, fallbackReason: r.fallbackReason };
  });
}

export async function createSubtasksAction(organizationId: string, parentTaskId: string, subtasks: ai.Subtask[]) {
  return toResult(async () => {
    const actor = await requireActor();
    const created = await ai.createSubtasks(db, actor.id, organizationId, parentTaskId, subtasks);
    const dtos = created.map(toTaskDTO);
    for (const task of dtos) broadcastOrgEvent(organizationId, { type: "TASK_CREATED", actor, task });
    return { tasks: dtos };
  });
}

export async function sprintDigestAction(organizationId: string, projectId: string, hours: number) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await ai.sprintDigest(db, actor.id, organizationId, projectId, Math.min(Math.max(hours, 1), 24 * 14));
    return { digest: r.data, provider: r.provider, fallbackReason: r.fallbackReason, stats: r.stats };
  });
}

export async function triageTaskAction(organizationId: string, projectId: string, title: string, description: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await ai.triageTask(db, actor.id, organizationId, projectId, { title, description });
    return { suggestion: { ...r.data, columnId: r.columnId }, provider: r.provider, fallbackReason: r.fallbackReason };
  });
}

export async function explainConflictAction(organizationId: string, taskId: string, sinceVersion: number) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await ai.explainConflict(db, actor.id, organizationId, taskId, sinceVersion);
    return { summary: r.data.summary, provider: r.provider };
  });
}
