"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { toResult } from "@/lib/errors";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { requireActor } from "@/lib/session";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { publishEffects } from "@/server/after-task-change";
import { publishTask } from "@/server/public-events";
import { newEffects } from "@/server/services/task-effects";
import * as tpl from "@/server/services/templates";
import * as onboarding from "@/server/services/onboarding";

/* --------------------------------- templates --------------------------------- */

export async function listProjectTemplatesAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { templates: await tpl.listProjectTemplates(db, actor.id, organizationId) };
  });
}

export async function saveProjectAsTemplateAction(organizationId: string, projectId: string, name: string, description: string | null, includeTasks: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    return await tpl.saveProjectAsTemplate(db, actor.id, organizationId, projectId, { name, description, includeTasks });
  });
}

export async function deleteProjectTemplateAction(organizationId: string, templateId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await tpl.deleteProjectTemplate(db, actor.id, organizationId, templateId);
    return {};
  });
}

export async function listTaskTemplatesAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { templates: await tpl.listTaskTemplates(db, actor.id, organizationId, projectId) };
  });
}

export async function saveTaskTemplateAction(organizationId: string, taskId: string, name: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return await tpl.saveTaskTemplate(db, actor.id, organizationId, taskId, name);
  });
}

export async function createTaskFromTemplateAction(organizationId: string, templateId: string, columnId: string | null, today?: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const fx = newEffects(today);
    const r = await tpl.createTaskFromTemplate(db, actor.id, organizationId, templateId, columnId, fx);
    for (const t of r.created) {
      broadcastOrgEvent(organizationId, { type: "TASK_CREATED", actor, task: toTaskDTO(t) });
      publishTask(organizationId, "task.created", t);
    }
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId: r.task.projectId, taskIds: [r.task.id], kind: "checklist" });
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId: r.task.projectId, taskIds: [r.task.id], kind: "tags" });
    publishEffects(organizationId, actor, r.task.projectId, fx);
    return { taskId: r.task.id };
  });
}

export async function deleteTaskTemplateAction(organizationId: string, templateId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await tpl.deleteTaskTemplate(db, actor.id, organizationId, templateId);
    return {};
  });
}

/* --------------------------------- onboarding --------------------------------- */

export async function dismissOnboardingAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await onboarding.dismissOnboarding(db, actor.id, organizationId);
    revalidatePath("/w", "layout");
    return {};
  });
}

/* ----------------------------------- search ----------------------------------- */

export async function searchWorkspaceAction(organizationId: string, q: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return await onboarding.searchWorkspace(db, actor.id, organizationId, q);
  });
}
