"use server";

import { db } from "@/db";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import * as svc from "@/server/services/breakdown";

/** Thin wrappers: actor from the session → service → broadcast after commit. */

export async function getProjectMetaAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { meta: await svc.getProjectMeta(db, actor.id, organizationId, projectId) };
  });
}

export async function listChecklistAction(organizationId: string, taskId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { items: await svc.listChecklist(db, actor.id, organizationId, taskId) };
  });
}

export async function addChecklistItemAction(organizationId: string, taskId: string, text: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { item, projectId } = await svc.addChecklistItem(db, actor.id, organizationId, taskId, text);
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [taskId], kind: "checklist" });
    return { item: { id: item.id, text: item.text, done: item.done, position: item.position } };
  });
}

export async function setChecklistItemDoneAction(organizationId: string, itemId: string, done: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    const { item, projectId } = await svc.setChecklistItemDone(db, actor.id, organizationId, itemId, done);
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [item.taskId], kind: "checklist" });
    return {};
  });
}

export async function deleteChecklistItemAction(organizationId: string, itemId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { item, projectId } = await svc.deleteChecklistItem(db, actor.id, organizationId, itemId);
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [item.taskId], kind: "checklist" });
    return {};
  });
}

export async function createTagAction(organizationId: string, name: string, color: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const tag = await svc.createTag(db, actor.id, organizationId, { name, color: color as never });
    return { tag: { id: tag.id, name: tag.name, color: tag.color } };
  });
}

export async function setTaskTagAction(organizationId: string, taskId: string, tagId: string, on: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId, changed } = await svc.setTaskTag(db, actor.id, organizationId, taskId, tagId, on);
    if (changed) broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [taskId], kind: "tags" });
    return {};
  });
}

export async function addDependencyAction(organizationId: string, blockerId: string, blockedId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId } = await svc.addDependency(db, actor.id, organizationId, blockerId, blockedId);
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [blockerId, blockedId], kind: "dependencies" });
    return {};
  });
}

export async function removeDependencyAction(organizationId: string, blockerId: string, blockedId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId } = await svc.removeDependency(db, actor.id, organizationId, blockerId, blockedId);
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [blockerId, blockedId], kind: "dependencies" });
    return {};
  });
}
