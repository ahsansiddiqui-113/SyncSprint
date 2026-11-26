import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, organizations, webhookDeliveries, webhooks } from "@/db/schema";
import { billingState } from "@/lib/billing-rules";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Outgoing webhooks. Each delivery is a JSON POST signed like Stripe:
 *   SyncSprint-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>
 *
 * Safety: only https URLs on public addresses (no localhost / private / link-local /
 * cloud metadata ranges, checked after DNS resolution), no redirects, 5 s timeout,
 * a hook is switched off after 15 failures in a row.
 */

export const WEBHOOK_EVENTS = ["task.created", "task.updated", "task.deleted", "comment.created"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "ping";
const MAX_FAILURES = 15;
const MAX_HOOKS = 20;

const allowPrivate = () => process.env.WEBHOOKS_ALLOW_PRIVATE === "true" && process.env.NODE_ENV !== "production";

/** True for addresses a webhook must never reach. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

/** Validate a destination: scheme, port, and every resolved address. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("VALIDATION", "Enter a full URL, like https://example.com/hooks/syncsprint");
  }
  if (url.username || url.password) throw new AppError("VALIDATION", "URLs with credentials aren't allowed");
  if (allowPrivate()) {
    if (!["http:", "https:"].includes(url.protocol)) throw new AppError("VALIDATION", "Use an http(s) URL");
    return url;
  }
  if (url.protocol !== "https:") throw new AppError("VALIDATION", "Webhook URLs must use https");
  if (url.port && !["443", "8443"].includes(url.port)) throw new AppError("VALIDATION", "Use the standard https port");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new AppError("VALIDATION", "Webhooks can't point at internal hosts");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new AppError("VALIDATION", "That host doesn't resolve");
  if (addrs.some(isPrivateAddress)) throw new AppError("VALIDATION", "Webhooks can't point at private or internal addresses");
  return url;
}

export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** What receivers should do (also used by tests): recompute and compare, reject old timestamps. */
export function verifySignature(secret: string, body: string, header: string, toleranceSec = 300, now = Math.floor(Date.now() / 1000)) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  if (Math.abs(now - Number(m[1])) > toleranceSec) return false;
  const expected = Buffer.from(sign(secret, body, Number(m[1])));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/* ------------------------------------ CRUD ------------------------------------ */

const hookInput = z.object({
  url: z.string().trim().max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event"),
});

export async function createWebhook(conn: DB, actorId: string, organizationId: string, raw: z.input<typeof hookInput>) {
  const input = hookInput.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const url = await assertSafeUrl(input.url);
  const [{ n }] = (await conn.select({ n: sql<number>`count(*)::int` }).from(webhooks).where(eq(webhooks.organizationId, organizationId))) as [{ n: number }];
  if (n >= MAX_HOOKS) throw new AppError("VALIDATION", `A workspace can have up to ${MAX_HOOKS} webhooks`);
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const [row] = await conn
    .insert(webhooks)
    .values({ organizationId, url: url.toString(), secret, events: [...new Set(input.events)], createdById: actorId })
    .returning();
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "WEBHOOK_CREATED", entityType: "webhook", entityId: row!.id, metadata: { url: url.origin } });
  return row!;
}

export async function listWebhooks(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.select().from(webhooks).where(eq(webhooks.organizationId, organizationId)).orderBy(desc(webhooks.createdAt));
}

export async function updateWebhook(conn: DB, actorId: string, organizationId: string, id: string, raw: { events?: string[]; enabled?: boolean }) {
  const input = z.object({ events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(), enabled: z.boolean().optional() }).parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [row] = await conn
    .update(webhooks)
    .set({ ...(input.events ? { events: [...new Set(input.events)] } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled, consecutiveFailures: 0 } : {}) })
    .where(and(eq(webhooks.id, id), eq(webhooks.organizationId, organizationId)))
    .returning();
  if (!row) throw new AppError("NOT_FOUND", "Webhook not found");
  return row;
}

export async function deleteWebhook(conn: DB, actorId: string, organizationId: string, id: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [row] = await conn.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.organizationId, organizationId))).returning({ url: webhooks.url });
  if (!row) throw new AppError("NOT_FOUND", "Webhook not found");
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "WEBHOOK_DELETED", entityType: "webhook", entityId: id, metadata: { url: new URL(row.url).origin } });
}

export async function listDeliveries(conn: DB, actorId: string, organizationId: string, webhookId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.organizationId, organizationId), eq(webhookDeliveries.webhookId, webhookId)))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(25);
}

/* ---------------------------------- delivery ---------------------------------- */

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** POST one event to one hook and record the outcome. Never throws. */
export async function deliver(conn: DB, hook: typeof webhooks.$inferSelect, event: WebhookEvent, data: unknown, fetcher: Fetcher = fetch) {
  const body = JSON.stringify({ id: randomBytes(12).toString("hex"), event, createdAt: new Date().toISOString(), organizationId: hook.organizationId, data });
  const started = Date.now();
  let status: number | null = null;
  let error: string | null = null;
  try {
    await assertSafeUrl(hook.url); // re-check: DNS may have changed since the hook was saved
    const res = await fetcher(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "SyncSprint-Webhooks/1.0", "SyncSprint-Event": event, "SyncSprint-Signature": sign(hook.secret, body) },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    status = res.status;
    if (res.status >= 300) error = res.status >= 300 && res.status < 400 ? "Redirects aren't followed" : `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof AppError ? err.message : err instanceof Error && err.name === "TimeoutError" ? "Timed out after 5s" : "Couldn't connect";
  }
  const ok = !error;
  const durationMs = Date.now() - started;
  try {
    await conn.insert(webhookDeliveries).values({ organizationId: hook.organizationId, webhookId: hook.id, event, statusCode: status, ok, durationMs, error });
    await conn
      .update(webhooks)
      .set({
        lastStatus: status,
        lastDeliveryAt: new Date(),
        consecutiveFailures: ok ? 0 : sql`${webhooks.consecutiveFailures} + 1`,
        enabled: ok ? true : sql`${webhooks.consecutiveFailures} + 1 < ${MAX_FAILURES}`,
      })
      .where(eq(webhooks.id, hook.id));
    // Keep the log bounded.
    await conn.execute(
      sql`delete from webhook_deliveries where webhook_id = ${hook.id} and id not in (select id from webhook_deliveries where webhook_id = ${hook.id} order by created_at desc limit 100)`
    );
  } catch (err) {
    console.error("[webhooks] failed to record delivery", err);
  }
  return { ok, status, error, durationMs };
}

/** Fan an event out to every enabled hook subscribed to it. */
export async function dispatchEvent(conn: DB, organizationId: string, event: WebhookEvent, data: unknown | (() => Promise<unknown>), fetcher?: Fetcher) {
  const hooks = await conn.select().from(webhooks).where(and(eq(webhooks.organizationId, organizationId), eq(webhooks.enabled, true)));
  const targets = hooks.filter((h) => h.events.includes(event));
  if (!targets.length) return [];
  // Integrations pause while a workspace is read-only or locked for billing.
  const [org] = await conn.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org || billingState(org).access !== "full") return [];
  const payload = typeof data === "function" ? await (data as () => Promise<unknown>)() : data;
  return Promise.all(targets.map((h) => deliver(conn, h, event, payload, fetcher)));
}

/** "Send test event" button. */
export async function pingWebhook(conn: DB, actorId: string, organizationId: string, id: string, fetcher?: Fetcher) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [hook] = await conn.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.organizationId, organizationId))).limit(1);
  if (!hook) throw new AppError("NOT_FOUND", "Webhook not found");
  return deliver(conn, hook, "ping", { message: "Hello from SyncSprint" }, fetcher);
}
