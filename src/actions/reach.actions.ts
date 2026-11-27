"use server";

import { headers } from "next/headers";
import { db } from "@/db";
import { toResult } from "@/lib/errors";
import { requireActor } from "@/lib/session";
import * as chat from "@/server/services/chat";
import * as out from "@/server/services/outbound";
import * as inbound from "@/server/services/inbound-email";
import * as dev from "@/server/services/devlinks";

/* ------------------------------- chat channels ------------------------------- */

export async function listChatChannelsAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await chat.listChannels(db, actor.id, organizationId);
    return { channels: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), lastSentAt: r.lastSentAt?.toISOString() ?? null })) };
  });
}

type ChannelInput = { kind: "slack" | "teams" | "discord" | "google_chat"; name: string; url?: string; projectId?: string | null; events: (typeof chat.CHAT_EVENTS)[number][]; enabled: boolean };

export async function saveChatChannelAction(organizationId: string, channelId: string | null, input: ChannelInput) {
  return toResult(async () => {
    const actor = await requireActor();
    if (channelId) await chat.updateChannel(db, actor.id, organizationId, channelId, input);
    else await chat.createChannel(db, actor.id, organizationId, input);
    return {};
  });
}

export async function deleteChatChannelAction(organizationId: string, channelId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await chat.deleteChannel(db, actor.id, organizationId, channelId);
    return {};
  });
}

export async function testChatChannelAction(organizationId: string, channelId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await chat.testChannel(db, actor.id, organizationId, channelId);
    return {};
  });
}

/* ------------------------- notification preferences ------------------------- */

export async function getNotificationPrefsAction() {
  return toResult(async () => {
    const actor = await requireActor();
    return await out.getPrefs(db, actor.id);
  });
}

export async function setNotificationPrefsAction(organizationId: string, prefs: out.Prefs) {
  return toResult(async () => {
    const actor = await requireActor();
    await out.setPrefs(db, actor.id, organizationId, prefs);
    return {};
  });
}

export async function savePushSubscriptionAction(sub: unknown) {
  return toResult(async () => {
    const actor = await requireActor();
    await out.savePushSubscription(db, actor.id, sub, (await headers()).get("user-agent"));
    return {};
  });
}

export async function removePushSubscriptionAction(endpoint: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await out.removePushSubscription(db, actor.id, endpoint);
    return {};
  });
}

export async function sendTestPushAction() {
  return toResult(async () => {
    const actor = await requireActor();
    const sent = await out.sendPush(db, actor.id, { title: "SyncSprint", body: "Push notifications are working on this device.", url: "/account/notifications", tag: "test" });
    return { sent };
  });
}

export async function devOutboxAction() {
  return toResult(async () => {
    await requireActor();
    const rows = await out.devOutbox(db);
    return { rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  });
}

/* -------------------------------- calendar feed -------------------------------- */

export async function calendarFeedStatusAction() {
  return toResult(async () => {
    const actor = await requireActor();
    return { active: await out.hasCalendarFeed(db, actor.id) };
  });
}

export async function rotateCalendarFeedAction() {
  return toResult(async () => {
    const actor = await requireActor();
    return { token: await out.rotateCalendarFeed(db, actor.id) };
  });
}

export async function revokeCalendarFeedAction() {
  return toResult(async () => {
    const actor = await requireActor();
    await out.revokeCalendarFeed(db, actor.id);
    return {};
  });
}

/* ------------------------------- email-to-task ------------------------------- */

export async function getInboundAddressAction(organizationId: string, projectId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return await inbound.getInboundAddress(db, actor.id, organizationId, projectId);
  });
}

export async function rotateInboundAddressAction(organizationId: string, projectId: string, on: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    return await inbound.rotateInboundAddress(db, actor.id, organizationId, projectId, on);
  });
}

/* ------------------------------ GitHub / GitLab ------------------------------ */


export async function listReposAction(organizationId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await dev.listConnections(db, actor.id, organizationId);
    return { repos: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), lastEventAt: r.lastEventAt?.toISOString() ?? null })) };
  });
}

export async function createRepoAction(organizationId: string, provider: "github" | "gitlab", name: string, autoClose: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    return await dev.createConnection(db, actor.id, organizationId, { provider, name, autoClose });
  });
}

export async function updateRepoAction(organizationId: string, id: string, autoClose: boolean, enabled: boolean) {
  return toResult(async () => {
    const actor = await requireActor();
    await dev.updateConnection(db, actor.id, organizationId, id, { autoClose, enabled });
    return {};
  });
}

export async function rotateRepoSecretAction(organizationId: string, id: string) {
  return toResult(async () => {
    const actor = await requireActor();
    return { secret: await dev.rotateConnectionSecret(db, actor.id, organizationId, id) };
  });
}

export async function deleteRepoAction(organizationId: string, id: string) {
  return toResult(async () => {
    const actor = await requireActor();
    await dev.deleteConnection(db, actor.id, organizationId, id);
    return {};
  });
}

export async function listDevLinksAction(organizationId: string, taskId: string) {
  return toResult(async () => {
    const actor = await requireActor();
    const rows = await dev.listDevLinks(db, actor.id, organizationId, taskId);
    return { links: rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })) };
  });
}
