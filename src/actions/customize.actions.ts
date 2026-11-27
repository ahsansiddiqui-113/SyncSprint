"use server";

import { alertManagers, pingInboxes } from "@/server/inbox-broadcast";
import { db } from "@/db";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { capacityWarnings } from "@/server/services/capacity";
import * as svc from "@/server/services/customize";
import { eq } from "drizzle-orm";
import { tasks, type SavedViewConfig } from "@/db/schema";

type Actor = { id: string; name: string };
const configChanged = (organizationId: string, actor: Actor, projectId: string) =>
  broadcastOrgEvent(organizationId, { type: "PROJECT_CONFIG_CHANGED", actor, projectId });

/* statuses */
export async function addStatusAction(organizationId: string, projectId: string, title: string, color: string | null) {
  return toResult(async () => {
    const actor = await requireActor();
    const col = await svc.addStatus(db, actor.id, organizationId, projectId, { title, color });
    configChanged(organizationId, actor, projectId);
    return { id: col.id };
  });
}
export async function updateStatusAction(organizationId: string, columnId: string, patch: { title?: string; color?: string | null; wipLimit?: number | null }) {
  return toResult(async () => {
    const actor = await requireActor();
    const col = await svc.updateStatus(db, actor.id, organizationId, columnId, patch);
    configChanged(organizationId, actor, col.projectId);
    return {};
  });
}
export async function moveStatusAction(organizationId: string, columnId: string, dir: "left" | "right") {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId } = await svc.moveStatus(db, actor.id, organizationId, columnId, dir);
    configChanged(organizationId, actor, projectId);
    return {};
  });
}
export async function deleteStatusAction(organizationId: string, columnId: string, moveTo: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId, moved } = await svc.deleteStatus(db, actor.id, organizationId, columnId, moveTo);
    for (const t of moved) broadcastOrgEvent(organizationId, { type: "TASK_UPDATED", actor, task: toTaskDTO(t), action: "moved" });
    configChanged(organizationId, actor, projectId);
    return { moved: moved.length };
  });
}

/* custom fields */
export async function createFieldAction(organizationId: string, projectId: string, input: { name: string; type: string; options?: { id?: string; label: string; color: string }[] }) {
  return toResult(async () => {
    const actor = await requireActor();
    const f = await svc.createField(db, actor.id, organizationId, projectId, input);
    configChanged(organizationId, actor, projectId);
    return { id: f.id };
  });
}
export async function updateFieldAction(organizationId: string, fieldId: string, input: { name?: string; options?: { id?: string; label: string; color: string }[] }) {
  return toResult(async () => {
    const actor = await requireActor();
    const f = await svc.updateField(db, actor.id, organizationId, fieldId, input);
    configChanged(organizationId, actor, f.projectId);
    return {};
  });
}
export async function deleteFieldAction(organizationId: string, fieldId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const f = await svc.deleteField(db, actor.id, organizationId, fieldId);
    configChanged(organizationId, actor, f.projectId);
    return {};
  });
}
export async function setFieldValueAction(organizationId: string, taskId: string, fieldId: string, value: string | number | null) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId } = await svc.setFieldValue(db, actor.id, organizationId, taskId, fieldId, value);
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [taskId], kind: "fields" });
    return {};
  });
}

/* people */
export async function setCoAssigneesAction(organizationId: string, taskId: string, userIds: string[], today?: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId, coAssignees, notified } = await svc.setCoAssignees(db, actor.id, organizationId, taskId, userIds);
    pingInboxes(organizationId, notified);
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [taskId], kind: "people" });
    // Advisory capacity check for the newly assigned people (never blocks).
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    const warnings = task && task.estimateHours && coAssignees.length
      ? await capacityWarnings(db, organizationId, [...(task.assigneeId ? [task.assigneeId] : []), ...coAssignees], task, today).catch(() => [])
      : [];
    await alertManagers(organizationId, actor.id, taskId, warnings);
    return { warnings };
  });
}
export async function setWatchingAction(organizationId: string, taskId: string, on: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId } = await svc.setWatching(db, actor.id, organizationId, taskId, on);
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [taskId], kind: "people" });
    return {};
  });
}

/* saved views */
export async function listSavedViewsAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await svc.listSavedViews(db, actor.id, organizationId, projectId);
    return { views: rows.map((v) => ({ id: v.id, name: v.name, config: v.config, shared: v.shared, mine: v.ownerId === actor.id })) };
  });
}
export async function saveViewAction(organizationId: string, projectId: string, input: { name: string; config: SavedViewConfig; shared?: boolean }) {
  return toResult(async () => {
    const actor = await requireActor();
    const v = await svc.saveView(db, actor.id, organizationId, projectId, input);
    return { view: { id: v.id, name: v.name, config: v.config, shared: v.shared, mine: true } };
  });
}
export async function updateSavedViewAction(organizationId: string, viewId: string, input: { name?: string; config?: SavedViewConfig; shared?: boolean }) {
  return toResult(async () => {
    const actor = await requireActor();
    const v = await svc.updateSavedView(db, actor.id, organizationId, viewId, input);
    return { view: { id: v.id, name: v.name, config: v.config, shared: v.shared, mine: v.ownerId === actor.id } };
  });
}
export async function deleteSavedViewAction(organizationId: string, viewId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await svc.deleteSavedView(db, actor.id, organizationId, viewId);
    return {};
  });
}
