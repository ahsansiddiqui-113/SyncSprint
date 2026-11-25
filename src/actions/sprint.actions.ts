"use server";

import { db } from "@/db";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import * as svc from "@/server/services/sprints";

type Actor = { id: string; name: string };

function announce(organizationId: string, actor: Actor, projectId: string) {
  broadcastOrgEvent(organizationId, { type: "SPRINTS_CHANGED", actor, projectId });
}

export async function listSprintsAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { sprints: await svc.listSprints(db, actor.id, organizationId, projectId) };
  });
}

export async function createSprintAction(organizationId: string, projectId: string, input: { name?: string; goal?: string | null; startDate?: string | null; endDate?: string | null } = {}) {
  return toResult(async () => {
    const actor = await requireActor();
    const sprint = await svc.createSprint(db, actor.id, organizationId, projectId, input);
    announce(organizationId, actor, projectId);
    return { sprint };
  });
}

export async function updateSprintAction(organizationId: string, sprintId: string, patch: { name?: string; goal?: string | null; startDate?: string | null; endDate?: string | null }) {
  return toResult(async () => {
    const actor = await requireActor();
    const sprint = await svc.updateSprint(db, actor.id, organizationId, sprintId, patch);
    announce(organizationId, actor, sprint.projectId);
    return { sprint };
  });
}

export async function startSprintAction(organizationId: string, sprintId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const sprint = await svc.startSprint(db, actor.id, organizationId, sprintId);
    announce(organizationId, actor, sprint.projectId);
    return { sprint };
  });
}

export async function completeSprintAction(organizationId: string, sprintId: string, moveOpenTo: "backlog" | string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { sprint, movedTasks } = await svc.completeSprint(db, actor.id, organizationId, sprintId, { moveOpenTo });
    for (const t of movedTasks) broadcastOrgEvent(organizationId, { type: "TASK_UPDATED", actor, task: toTaskDTO(t), action: "edited", changes: ["sprint"] });
    announce(organizationId, actor, sprint.projectId);
    return { sprint, moved: movedTasks.length };
  });
}

export async function deleteSprintAction(organizationId: string, sprintId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId, freedTasks } = await svc.deleteSprint(db, actor.id, organizationId, sprintId);
    for (const t of freedTasks) broadcastOrgEvent(organizationId, { type: "TASK_UPDATED", actor, task: toTaskDTO(t), action: "edited", changes: ["sprint"] });
    announce(organizationId, actor, projectId);
    return {};
  });
}

export async function sprintReportAction(organizationId: string, sprintId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { report: await svc.getSprintReport(db, actor.id, organizationId, sprintId) };
  });
}

export async function velocityAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { velocity: await svc.getVelocity(db, actor.id, organizationId, projectId) };
  });
}
