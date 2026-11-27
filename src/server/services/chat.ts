import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, chatChannels, organizations, projects, type ChatKind } from "@/db/schema";
import { billingState } from "@/lib/billing-rules";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { hint, seal, unseal } from "@/lib/seal";

/**
 * Chat alerts: post task and comment events to Slack, Microsoft Teams, Discord or Google Chat
 * through their incoming-webhook URLs (no app install needed). One channel can follow the whole
 * workspace or a single project. URLs are encrypted at rest; only the provider's own hosts are
 * accepted (no requests into private networks); a channel turns itself off after 10 failures.
 */

export const CHAT_EVENTS = ["task.created", "task.status", "task.assigned", "comment.created"] as const;
export type ChatEvent = (typeof CHAT_EVENTS)[number];
const MAX_CHANNELS = 30;
const MAX_FAILURES = 10;

const HOSTS: Record<ChatKind, (u: URL) => boolean> = {
  slack: (u) => u.hostname === "hooks.slack.com" && u.pathname.startsWith("/services/"),
  teams: (u) => /(^|\.)webhook\.office\.com$/.test(u.hostname) || /\.logic\.azure\.com$/.test(u.hostname) || /\.environment\.api\.powerplatform\.com$/.test(u.hostname),
  discord: (u) => ["discord.com", "discordapp.com"].includes(u.hostname) && u.pathname.startsWith("/api/webhooks/"),
  google_chat: (u) => u.hostname === "chat.googleapis.com" && u.pathname.startsWith("/v1/spaces/"),
};
export const KIND_LABEL: Record<ChatKind, string> = { slack: "Slack", teams: "Microsoft Teams", discord: "Discord", google_chat: "Google Chat" };

export function validateChatUrl(kind: ChatKind, raw: string) {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new AppError("VALIDATION", "Paste the full webhook URL");
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) throw new AppError("VALIDATION", "Webhook URLs must be plain https");
  if (!HOSTS[kind](u)) throw new AppError("VALIDATION", `That isn't a ${KIND_LABEL[kind]} incoming-webhook URL`);
  return u.toString();
}

const input = z.object({
  kind: z.enum(["slack", "teams", "discord", "google_chat"]),
  name: z.string().trim().min(1, "Name the channel").max(80),
  url: z.string().max(2000).optional(),
  projectId: z.string().uuid().nullish(),
  events: z.array(z.enum(CHAT_EVENTS)).min(1, "Pick at least one event"),
  enabled: z.boolean().default(true),
});

export async function listChannels(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const rows = await conn
    .select({ c: chatChannels, project: projects.key })
    .from(chatChannels)
    .leftJoin(projects, eq(projects.id, chatChannels.projectId))
    .where(eq(chatChannels.organizationId, organizationId))
    .orderBy(desc(chatChannels.createdAt));
  return rows.map(({ c, project }) => {
    const { urlSealed: _s, ...rest } = c;
    void _s;
    return { ...rest, projectKey: project };
  });
}

async function projectOk(conn: DB, organizationId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const [p] = await conn.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
}

export async function createChannel(conn: DB, actorId: string, organizationId: string, raw: z.input<typeof input>) {
  const v = input.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const url = validateChatUrl(v.kind, v.url ?? "");
  await projectOk(conn, organizationId, v.projectId);
  const [{ n }] = (await conn.select({ n: sql<number>`count(*)::int` }).from(chatChannels).where(eq(chatChannels.organizationId, organizationId))) as [{ n: number }];
  if (n >= MAX_CHANNELS) throw new AppError("VALIDATION", `Up to ${MAX_CHANNELS} chat channels`);
  const [c] = await conn.insert(chatChannels).values({ organizationId, projectId: v.projectId ?? null, kind: v.kind, name: v.name, urlSealed: seal(url), urlHint: hint(url), events: v.events, enabled: v.enabled, createdById: actorId }).returning({ id: chatChannels.id });
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "CHAT_CHANNEL_ADDED", entityType: "organization", entityId: organizationId, metadata: { kind: v.kind, name: v.name } });
  return c!;
}

/** Change name / project / events / on-off; a new URL is optional (keeps the old one). Re-enabling resets failures. */
export async function updateChannel(conn: DB, actorId: string, organizationId: string, channelId: string, raw: z.input<typeof input>) {
  const v = input.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  await projectOk(conn, organizationId, v.projectId);
  const url = v.url?.trim() ? validateChatUrl(v.kind, v.url) : null;
  const [c] = await conn
    .update(chatChannels)
    .set({ name: v.name, projectId: v.projectId ?? null, events: v.events, enabled: v.enabled, ...(v.enabled ? { failures: 0, lastError: null } : {}), ...(url ? { urlSealed: seal(url), urlHint: hint(url), kind: v.kind } : {}) })
    .where(and(eq(chatChannels.id, channelId), eq(chatChannels.organizationId, organizationId)))
    .returning({ id: chatChannels.id });
  if (!c) throw new AppError("NOT_FOUND", "Channel not found");
}

export async function deleteChannel(conn: DB, actorId: string, organizationId: string, channelId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const gone = await conn.delete(chatChannels).where(and(eq(chatChannels.id, channelId), eq(chatChannels.organizationId, organizationId))).returning({ id: chatChannels.id });
  if (!gone.length) throw new AppError("NOT_FOUND", "Channel not found");
}

/* -------------------------------- formatting -------------------------------- */

export type ChatMessage = { title: string; text: string; url: string; color: string };

export function formatFor(kind: ChatKind, m: ChatMessage): unknown {
  const linkText = "Open in SyncSprint";
  switch (kind) {
    case "slack":
      return {
        text: `${m.title}: ${m.text}`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*${esc(m.title)}*\n${esc(m.text)}` } },
          { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: linkText }, url: m.url }] },
        ],
      };
    case "teams":
      return {
        type: "message",
        attachments: [{
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4",
            body: [{ type: "TextBlock", text: m.title, weight: "Bolder", wrap: true }, { type: "TextBlock", text: m.text, wrap: true }],
            actions: [{ type: "Action.OpenUrl", title: linkText, url: m.url }],
          },
        }],
      };
    case "discord":
      return { embeds: [{ title: m.title.slice(0, 256), description: m.text.slice(0, 2000), url: m.url, color: parseInt(m.color.slice(1), 16) }], allowed_mentions: { parse: [] } };
    case "google_chat":
      return { text: `*${m.title}*\n${m.text}\n<${m.url}|${linkText}>` };
  }
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

async function post(conn: DB, c: typeof chatChannels.$inferSelect, m: ChatMessage, fetcher: Fetcher) {
  let error: string | null = null;
  try {
    const res = await fetcher(unseal(c.urlSealed), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(formatFor(c.kind, m)),
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 200) : "Request failed";
  }
  if (error) {
    const failures = c.failures + 1;
    await conn.update(chatChannels).set({ failures, lastError: error, enabled: failures < MAX_FAILURES }).where(eq(chatChannels.id, c.id));
  } else {
    await conn.update(chatChannels).set({ failures: 0, lastError: null, lastSentAt: new Date() }).where(eq(chatChannels.id, c.id));
  }
  return error;
}

/** Send one event to every enabled channel that follows it (workspace-wide or this project). */
export async function deliverChat(conn: DB, organizationId: string, projectId: string | null, event: ChatEvent, m: ChatMessage, fetcher: Fetcher = fetch) {
  const channels = await conn
    .select()
    .from(chatChannels)
    .where(and(eq(chatChannels.organizationId, organizationId), eq(chatChannels.enabled, true), projectId ? or(isNull(chatChannels.projectId), eq(chatChannels.projectId, projectId)) : isNull(chatChannels.projectId)));
  const targets = channels.filter((c) => c.events.includes(event));
  await Promise.all(targets.map((c) => post(conn, c, m, fetcher)));
  return targets.length;
}

export async function testChannel(conn: DB, actorId: string, organizationId: string, channelId: string, fetcher: Fetcher = fetch) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [c] = await conn.select().from(chatChannels).where(and(eq(chatChannels.id, channelId), eq(chatChannels.organizationId, organizationId))).limit(1);
  if (!c) throw new AppError("NOT_FOUND", "Channel not found");
  const error = await post(conn, c, { title: "SyncSprint is connected", text: `This channel will get: ${c.events.join(", ")}.`, url: process.env.NEXT_PUBLIC_APP_URL || "https://syncsprint.app", color: "#7b68ee" }, fetcher);
  if (error) throw new AppError("VALIDATION", `The test message failed: ${error}`);
}

/**
 * Turn a webhook-bus event into chat messages. Called with the public payload the API and
 * webhooks already build, so chat sees exactly what integrations see.
 */
export async function chatFromEvent(conn: DB, organizationId: string, event: string, payload: unknown, fetcher: Fetcher = fetch) {
  const p = payload as { task?: { ref: string; title: string; url: string; status: string; priority: string; assignee: { name: string } | null; projectId?: string }; changes?: string[]; comment?: { body: string; author: { name: string } } };
  const t = p.task;
  if (!t) return 0;
  const projectId = await projectIdOfUrl(conn, organizationId, t.ref);
  if (event === "task.created") {
    return deliverChat(conn, organizationId, projectId, "task.created", { title: `New: ${t.ref} ${t.title}`, text: `${t.status} · ${t.priority}${t.assignee ? ` · ${t.assignee.name}` : ""}`, url: t.url, color: "#7b68ee" }, fetcher);
  }
  if (event === "task.updated") {
    let n = 0;
    if (p.changes?.includes("status")) n += await deliverChat(conn, organizationId, projectId, "task.status", { title: `${t.ref} moved to ${t.status}`, text: t.title, url: t.url, color: "#0f9d74" }, fetcher);
    if (p.changes?.includes("assigneeId") && t.assignee) n += await deliverChat(conn, organizationId, projectId, "task.assigned", { title: `${t.ref} assigned to ${t.assignee.name}`, text: t.title, url: t.url, color: "#3f7cb8" }, fetcher);
    return n;
  }
  if (event === "comment.created" && p.comment) {
    return deliverChat(conn, organizationId, projectId, "comment.created", { title: `${p.comment.author.name} commented on ${t.ref}`, text: p.comment.body.slice(0, 500), url: t.url, color: "#dd6b00" }, fetcher);
  }
  return 0;
}

async function projectIdOfUrl(conn: DB, organizationId: string, ref: string) {
  const key = ref.split("-")[0] ?? "";
  const [p] = await conn.select({ id: projects.id }).from(projects).where(and(eq(projects.organizationId, organizationId), eq(projects.key, key))).limit(1);
  return p?.id ?? null;
}

/** Cheap check before building any payload: enabled channels exist and the workspace is fully active. */
export async function chatActive(conn: DB, organizationId: string) {
  const [c] = await conn.select({ id: chatChannels.id }).from(chatChannels).where(and(eq(chatChannels.organizationId, organizationId), eq(chatChannels.enabled, true))).limit(1);
  if (!c) return false;
  const [org] = await conn.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return !!org && billingState(org).access === "full";
}
