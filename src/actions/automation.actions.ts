"use server";

import { db } from "@/db";
import type { AutomationAction, AutomationCondition, AutomationTrigger } from "@/db/schema";
import { toResult } from "@/lib/errors";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { requireActor } from "@/lib/session";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { publishTask } from "@/server/public-events";
import * as auto from "@/server/services/automations";
import { setRecurrence } from "@/server/services/recurrence";
import { sprintCapacity } from "@/server/services/sprint-capacity";
import { commitImport, exportProjectCsv, previewImport } from "@/server/services/import-export";
import * as keys from "@/server/services/api-keys";
import * as hooks from "@/server/services/webhooks";

type AutomationInput = { name: string; enabled?: boolean; trigger: AutomationTrigger; conditions?: AutomationCondition[]; actions: AutomationAction[] };

/* --------------------------------- automations -------------------------------- */

export async function listAutomationsAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await auto.listAutomations(db, actor.id, organizationId, projectId);
    return { automations: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), lastRunAt: r.lastRunAt?.toISOString() ?? null })) };
  });
}

export async function saveAutomationAction(organizationId: string, projectId: string, id: string | null, input: AutomationInput) {
  return toResult(async () => {
    const actor = await requireActor();
    const row = id
      ? await auto.updateAutomation(db, actor.id, organizationId, id, input)
      : await auto.createAutomation(db, actor.id, organizationId, projectId, input);
    return { id: row.id };
  });
}

export async function setAutomationEnabledAction(organizationId: string, id: string, enabled: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    await auto.setAutomationEnabled(db, actor.id, organizationId, id, enabled);
    return {};
  });
}

export async function deleteAutomationAction(organizationId: string, id: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await auto.deleteAutomation(db, actor.id, organizationId, id);
    return {};
  });
}

export async function automationRunsAction(organizationId: string, id: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await auto.listAutomationRuns(db, actor.id, organizationId, id);
    return { runs: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  });
}

/* --------------------------------- recurrence --------------------------------- */

export async function setRecurrenceAction(organizationId: string, taskId: string, rule: { frequency: "daily" | "weekdays" | "weekly" | "monthly"; interval: number } | null) {
  return toResult(async () => {
    const actor = await requireActor();
    const { projectId } = await setRecurrence(db, actor.id, organizationId, taskId, rule);
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [taskId], kind: "fields" });
    return {};
  });
}

/* ------------------------------- sprint capacity ------------------------------- */

export async function sprintCapacityAction(organizationId: string, sprintId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return await sprintCapacity(db, actor.id, organizationId, sprintId);
  });
}

/* ------------------------------- import / export ------------------------------- */

export async function previewImportAction(organizationId: string, projectId: string, csv: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { preview: await previewImport(db, actor.id, organizationId, projectId, csv) };
  });
}

export async function commitImportAction(organizationId: string, projectId: string, csv: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const { created, skipped } = await commitImport(db, actor.id, organizationId, projectId, csv);
    for (const t of created) {
      broadcastOrgEvent(organizationId, { type: "TASK_CREATED", actor, task: toTaskDTO(t) });
      publishTask(organizationId, "task.created", t, { via: "import" });
    }
    broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: created.map((t) => t.id), kind: "tags" });
    return { count: created.length, skipped, tasks: created.map(toTaskDTO) };
  });
}

export async function exportProjectCsvAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return await exportProjectCsv(db, actor.id, organizationId, projectId);
  });
}

/* ---------------------------------- API keys ---------------------------------- */

export async function listApiKeysAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await keys.listApiKeys(db, actor.id, organizationId);
    return {
      keys: rows.map((k) => ({ ...k, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null })),
    };
  });
}

export async function createApiKeyAction(organizationId: string, input: { name: string; scope: "read" | "write" }) {
  return toResult(async () => {
    const actor = await requireActor();
    const { token } = await keys.createApiKey(db, actor.id, organizationId, input);
    return { token };
  });
}

export async function revokeApiKeyAction(organizationId: string, id: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await keys.revokeApiKey(db, actor.id, organizationId, id);
    return {};
  });
}

/* ---------------------------------- webhooks ---------------------------------- */

export async function listWebhooksAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await hooks.listWebhooks(db, actor.id, organizationId);
    return {
      webhooks: rows.map((h) => ({
        id: h.id,
        url: h.url,
        events: h.events,
        enabled: h.enabled,
        consecutiveFailures: h.consecutiveFailures,
        lastStatus: h.lastStatus,
        lastDeliveryAt: h.lastDeliveryAt?.toISOString() ?? null,
        secretHint: `${h.secret.slice(0, 10)}…`,
      })),
    };
  });
}

export async function createWebhookAction(organizationId: string, input: { url: string; events: string[] }) {
  return toResult(async () => {
    const actor = await requireActor();
    const h = await hooks.createWebhook(db, actor.id, organizationId, input as { url: string; events: (typeof hooks.WEBHOOK_EVENTS)[number][] });
    return { id: h.id, secret: h.secret };
  });
}

export async function updateWebhookAction(organizationId: string, id: string, input: { events?: string[]; enabled?: boolean }) {
  return toResult(async () => {
    const actor = await requireActor();
    await hooks.updateWebhook(db, actor.id, organizationId, id, input);
    return {};
  });
}

export async function deleteWebhookAction(organizationId: string, id: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await hooks.deleteWebhook(db, actor.id, organizationId, id);
    return {};
  });
}

export async function pingWebhookAction(organizationId: string, id: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return await hooks.pingWebhook(db, actor.id, organizationId, id);
  });
}

export async function webhookDeliveriesAction(organizationId: string, id: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await hooks.listDeliveries(db, actor.id, organizationId, id);
    return { deliveries: rows.map((d) => ({ id: d.id, event: d.event, statusCode: d.statusCode, ok: d.ok, durationMs: d.durationMs, error: d.error, createdAt: d.createdAt.toISOString() })) };
  });
}
