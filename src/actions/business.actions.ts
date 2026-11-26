"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import type { PlanId } from "@/lib/billing-rules";
import { appBaseUrl } from "@/lib/base-url";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import * as billing from "@/server/services/billing";
import * as teams from "@/server/services/teams";
import * as share from "@/server/services/share-links";
import * as platform from "@/server/services/platform-admin";
import { broadcastOrgEvent } from "@/server/realtime-hub";

/* ----------------------------------- billing ----------------------------------- */

export async function startCheckoutAction(organizationId: string, plan: PlanId) {
  return toResult(async () => {
    const actor = await requireActor();
    return await billing.startCheckout(db, actor.id, organizationId, plan, appBaseUrl());
  });
}

export async function openBillingPortalAction(organizationId: string, orgSlug: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return await billing.openBillingPortal(db, actor.id, organizationId, `${appBaseUrl()}/w/${orgSlug}/settings/billing`);
  });
}

export async function simulateBillingAction(organizationId: string, scenario: (typeof billing.SIMULATIONS)[number]) {
  return toResult(async () => {
    const actor = await requireActor();
    await billing.simulateBilling(db, actor.id, organizationId, scenario);
    revalidatePath("/w", "layout");
    return {};
  });
}

export async function setSupportAccessAction(organizationId: string, hours: number) {
  return toResult(async () => {
    const actor = await requireActor();
    const { until } = await billing.setSupportAccess(db, actor.id, organizationId, hours);
    return { until: until?.toISOString() ?? null };
  });
}

/* ----------------------------------- groups ----------------------------------- */

const groupsChanged = (organizationId: string, actor: { id: string; name: string }) => broadcastOrgEvent(organizationId, { type: "MEMBERSHIP_CHANGED", actor, userId: actor.id, role: null });

export async function createTeamAction(organizationId: string, input: { name: string; description?: string | null; leadId?: string | null; memberIds?: string[]; color?: string }) {
  return toResult(async () => {
    const actor = await requireActor();
    const t = await teams.createTeam(db, actor.id, organizationId, input as never);
    groupsChanged(organizationId, actor);
    return { id: t.id };
  });
}

export async function updateTeamAction(organizationId: string, teamId: string, input: { name?: string; description?: string | null; leadId?: string | null; memberIds?: string[]; color?: string }) {
  return toResult(async () => {
    const actor = await requireActor();
    await teams.updateTeam(db, actor.id, organizationId, teamId, input as never);
    groupsChanged(organizationId, actor);
    return {};
  });
}

export async function deleteTeamAction(organizationId: string, teamId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await teams.deleteTeam(db, actor.id, organizationId, teamId);
    groupsChanged(organizationId, actor);
    return {};
  });
}

export async function listTeamsAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { teams: await teams.listTeams(db, actor.id, organizationId) };
  });
}

export async function teamStatsAction(organizationId: string, teamId: string, today?: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { stats: await teams.teamStats(db, actor.id, organizationId, teamId, today) };
  });
}

/* --------------------------------- share links --------------------------------- */

export async function createShareLinkAction(
  organizationId: string,
  input: { scope: "project" | "workspace"; projectId?: string | null; label: string; expiresInDays?: number | null; password?: string | null; includeComments?: boolean }
) {
  return toResult(async () => {
    const actor = await requireActor();
    const { token } = await share.createShareLink(db, actor.id, organizationId, input);
    return { url: `${appBaseUrl()}/s/${token}` };
  });
}

export async function listShareLinksAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await share.listShareLinks(db, actor.id, organizationId);
    return {
      links: rows.map((l) => ({
        ...l,
        expiresAt: l.expiresAt?.toISOString() ?? null,
        revokedAt: l.revokedAt?.toISOString() ?? null,
        lastViewedAt: l.lastViewedAt?.toISOString() ?? null,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  });
}

export async function revokeShareLinkAction(organizationId: string, linkId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await share.revokeShareLink(db, actor.id, organizationId, linkId);
    return {};
  });
}

/* ------------------------------- platform console ------------------------------- */

export async function platformActionAction(organizationId: string, input: { action: platform.PlatformAction; days?: number; reason?: string }) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await platform.platformAction(db, actor.id, organizationId, input);
    revalidatePath("/platform");
    return r;
  });
}

export async function companyEventsAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await platform.companyEvents(db, actor.id, organizationId);
    return { events: rows.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })) };
  });
}

export async function provisionCompanyAction(input: { name: string; adminEmail: string; trialDays?: number }) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await platform.provisionCompany(db, actor.id, input);
    revalidatePath("/platform");
    return { slug: r.slug, inviteUrl: `${appBaseUrl()}/invite/${r.token}` };
  });
}
