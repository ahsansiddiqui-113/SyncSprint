"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import type { OrgRole } from "@/db/schema";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { broadcastOrgEvent, hub } from "@/server/realtime-hub";
import * as ws from "@/server/services/workspace";
import { createProjectFromTemplate } from "@/server/services/templates";

export async function createOrganizationAction(name: string) {
  const res = await toResult(async () => {
    const actor = await requireActor();
    const org = await ws.createOrganization(db, actor.id, { name });
    return { slug: org.slug };
  });
  if (res.ok) redirect(`/w/${res.slug}`);
  return res;
}

export async function createProjectAction(input: { organizationId: string; name: string; key: string; description?: string; templateId?: string | null }) {
  return toResult(async () => {
    const actor = await requireActor();
    // With a template: statuses, fields, tags and starter tasks are set up too.
    const project = await createProjectFromTemplate(db, actor.id, input);
    revalidatePath("/w", "layout");
    return { key: project.key };
  });
}

export async function changeMemberRoleAction(organizationId: string, userId: string, role: OrgRole) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await ws.changeMemberRole(db, actor.id, { organizationId, userId, role });
    broadcastOrgEvent(organizationId, { type: "MEMBERSHIP_CHANGED", actor, userId, role });
    revalidatePath("/w", "layout");
    return r;
  });
}

export async function removeMemberAction(organizationId: string, userId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await ws.removeMember(db, actor.id, organizationId, userId);
    broadcastOrgEvent(organizationId, { type: "MEMBERSHIP_CHANGED", actor, userId, role: null });
    hub.evictUser(organizationId, userId);
    revalidatePath("/w", "layout");
    return {};
  });
}

export async function createInviteAction(organizationId: string, email: string, role: OrgRole) {
  return toResult(async () => {
    const actor = await requireActor();
    const invite = await ws.createInvite(db, actor.id, { organizationId, email, role });
    revalidatePath("/w", "layout");
    return { token: invite.token };
  });
}

export async function revokeInviteAction(organizationId: string, inviteId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await ws.revokeInvite(db, actor.id, organizationId, inviteId);
    revalidatePath("/w", "layout");
    return {};
  });
}

export async function acceptInviteAction(token: string) {
  const res = await toResult(async () => {
    const actor = await requireActor();
    const org = await ws.acceptInvite(db, actor.id, token);
    broadcastOrgEvent(org.id, { type: "MEMBERSHIP_CHANGED", actor, userId: actor.id, role: null });
    return { slug: org.slug };
  });
  if (res.ok) redirect(`/w/${res.slug}`);
  return res;
}
