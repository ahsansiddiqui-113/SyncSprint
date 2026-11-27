"use server";

import { db } from "@/db";
import { toResult } from "@/lib/errors";
import { currentRequestIp } from "@/lib/request-ip";
import { requireActor } from "@/lib/session";
import * as sec from "@/server/services/security";

export async function getSecurityAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { settings: await sec.getSecuritySettings(db, actor.id, organizationId), myIp: (await currentRequestIp()) ?? null };
  });
}

export async function setRequire2faAction(organizationId: string, on: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    await sec.setRequire2fa(db, actor.id, organizationId, on);
    return {};
  });
}

export async function setIpAllowlistAction(organizationId: string, text: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return await sec.setIpAllowlist(db, actor.id, organizationId, text, await currentRequestIp());
  });
}

export async function setAuditRetentionAction(organizationId: string, days: number | null) {
  return toResult(async () => {
    const actor = await requireActor();
    await sec.setAuditRetention(db, actor.id, organizationId, days);
    return {};
  });
}
