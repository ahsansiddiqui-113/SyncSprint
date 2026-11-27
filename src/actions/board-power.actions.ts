"use server";

import { db } from "@/db";
import { toResult } from "@/lib/errors";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { currentRequestIp } from "@/lib/request-ip";
import { requireActor } from "@/lib/session";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { publishEffects } from "@/server/after-task-change";
import { publishTask } from "@/server/public-events";
import { newEffects } from "@/server/services/task-effects";
import * as forms from "@/server/services/forms";
import * as reminders from "@/server/services/reminders";

/* ----------------------------------- forms ----------------------------------- */

const formDTO = (f: Awaited<ReturnType<typeof forms.listForms>>[number]) => ({ ...f, createdAt: f.createdAt.toISOString() });

export async function listFormsAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { forms: (await forms.listForms(db, actor.id, organizationId, projectId)).map(formDTO), defaults: forms.DEFAULT_FIELDS };
  });
}

export async function saveFormAction(organizationId: string, projectId: string, formId: string | null, input: forms.FormInput) {
  return toResult(async () => {
    const actor = await requireActor();
    const f = formId ? await forms.updateForm(db, actor.id, organizationId, formId, input) : await forms.createForm(db, actor.id, organizationId, projectId, input);
    return { form: formDTO(f) };
  });
}

export async function deleteFormAction(organizationId: string, formId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await forms.deleteForm(db, actor.id, organizationId, formId);
    return {};
  });
}

export async function rotateFormLinkAction(organizationId: string, formId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { token: await forms.rotateFormLink(db, actor.id, organizationId, formId) };
  });
}

/** Public: no session. Abuse limits live in the service. */
export async function submitFormAction(token: string, values: Record<string, string>, honeypot: string) {
  return toResult(async () => {
    const fx = newEffects();
    const r = await forms.submitForm(db, token, values, { ip: (await currentRequestIp()) ?? null, honeypot }, fx);
    if (r.ref && "task" in r && r.task) {
      const actor = { id: "form", name: "Form" };
      broadcastOrgEvent(r.organizationId, { type: "TASK_CREATED", actor, task: toTaskDTO(r.task) });
      publishTask(r.organizationId, "task.created", r.task);
      publishEffects(r.organizationId, actor, r.task.projectId, fx);
      if (r.notified.length) broadcastOrgEvent(r.organizationId, { type: "NOTIFICATIONS_CHANGED", userIds: r.notified });
    }
    return { ref: r.ref };
  });
}

/* --------------------------------- reminders --------------------------------- */

const remDTO = (r: { id: string; remindAt: Date; note: string | null; sentAt: Date | null }) => ({ id: r.id, remindAt: r.remindAt.toISOString(), note: r.note, sentAt: r.sentAt?.toISOString() ?? null });

export async function listRemindersAction(organizationId: string, taskId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { reminders: (await reminders.listMyReminders(db, actor.id, organizationId, taskId)).map(remDTO) };
  });
}

export async function setReminderAction(organizationId: string, taskId: string, remindAt: string, note: string | null) {
  return toResult(async () => {
    const actor = await requireActor();
    return { reminder: remDTO(await reminders.setReminder(db, actor.id, organizationId, taskId, { remindAt, note })) };
  });
}

export async function deleteReminderAction(organizationId: string, reminderId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await reminders.deleteReminder(db, actor.id, organizationId, reminderId);
    return {};
  });
}
