"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { pingInboxes } from "@/server/inbox-broadcast";
import * as guests from "@/server/services/guests";

export async function guestCommentAction(organizationId: string, taskId: string, body: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const r = await guests.guestComment(db, actor.id, organizationId, taskId, body);
    broadcastOrgEvent(organizationId, { type: "COMMENT_ADDED", actor, taskId, commentId: r.comment.id });
    pingInboxes(organizationId, r.notified);
    revalidatePath("/w", "layout");
    return {};
  });
}

export async function listGuestAccessAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { guests: await guests.listGuestAccess(db, actor.id, organizationId) };
  });
}

export async function setGuestProjectAction(organizationId: string, userId: string, projectId: string, on: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    await guests.setGuestProject(db, actor.id, organizationId, userId, projectId, on);
    return {};
  });
}
