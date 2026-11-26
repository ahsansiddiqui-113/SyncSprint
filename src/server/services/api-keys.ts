import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { apiKeys, auditLogs, orgMembers, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Personal API keys for the REST API. A key acts as the person who created it, capped
 * at its scope ("read" never writes, even for an owner), and stops working the moment
 * that person leaves the workspace or loses the role a write needs.
 *
 * Only a SHA-256 hash is stored; the token (`ssk_<prefix>_<secret>`) is shown once.
 */

const TOKEN_RE = /^ssk_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{32,64})$/;
export const MAX_KEYS_PER_ORG = 50;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function generateToken() {
  const prefix = randomBytes(6).toString("base64url").replace(/[-_]/g, "x").slice(0, 8);
  const secret = randomBytes(32).toString("base64url");
  return { token: `ssk_${prefix}_${secret}`, prefix };
}

export async function createApiKey(conn: DB, actorId: string, organizationId: string, raw: { name: string; scope: "read" | "write" }) {
  const input = z.object({ name: z.string().trim().min(1, "Name the key").max(80), scope: z.enum(["read", "write"]) }).parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const existing = await conn.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.organizationId, organizationId), isNull(apiKeys.revokedAt)));
  if (existing.length >= MAX_KEYS_PER_ORG) throw new AppError("VALIDATION", `A workspace can have up to ${MAX_KEYS_PER_ORG} active keys`);
  const { token, prefix } = generateToken();
  const [row] = await conn
    .insert(apiKeys)
    .values({ organizationId, userId: actorId, name: input.name, scope: input.scope, prefix, tokenHash: hashToken(token) })
    .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scope: apiKeys.scope, createdAt: apiKeys.createdAt });
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "API_KEY_CREATED", entityType: "api_key", entityId: row!.id, metadata: { name: input.name, scope: input.scope } });
  return { key: row!, token };
}

export async function listApiKeys(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scope: apiKeys.scope,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
      ownerName: users.name,
    })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(eq(apiKeys.organizationId, organizationId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(conn: DB, actorId: string, organizationId: string, keyId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [row] = await conn
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.organizationId, organizationId), isNull(apiKeys.revokedAt)))
    .returning({ name: apiKeys.name });
  if (!row) throw new AppError("NOT_FOUND", "Key not found or already revoked");
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "API_KEY_REVOKED", entityType: "api_key", entityId: keyId, metadata: { name: row.name } });
}

export type ApiPrincipal = { keyId: string; organizationId: string; userId: string; userName: string; scope: "read" | "write" };

/** Resolve a bearer token. Any failure looks the same to the caller (no oracle). */
export async function authenticateApiKey(conn: DB, token: string | null | undefined): Promise<ApiPrincipal | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const hash = hashToken(token);
  const [row] = await conn
    .select({ key: apiKeys, userName: users.name, role: orgMembers.role })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .leftJoin(orgMembers, and(eq(orgMembers.organizationId, apiKeys.organizationId), eq(orgMembers.userId, apiKeys.userId)))
    .where(and(eq(apiKeys.tokenHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row || !row.role) return null; // creator left the workspace
  // Constant-time compare of the hash we looked up (defence in depth against index timing).
  if (!timingSafeEqual(Buffer.from(row.key.tokenHash), Buffer.from(hash))) return null;
  // Record usage at most once a minute per key.
  if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt.getTime() > 60_000) {
    await conn.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id));
  }
  return { keyId: row.key.id, organizationId: row.key.organizationId, userId: row.key.userId, userName: row.userName, scope: row.key.scope };
}

/* ------------------------------ rate limiting ------------------------------ */

const buckets: Map<string, { tokens: number; at: number }> = ((globalThis as { __ssApiBuckets?: Map<string, { tokens: number; at: number }> }).__ssApiBuckets ??= new Map());

/** Token bucket per key: 120 requests/minute, bursts up to 120. Per server instance. */
export function takeRateLimit(keyId: string, now = Date.now(), perMinute = 120): { ok: boolean; remaining: number; retryAfter: number } {
  const b = buckets.get(keyId) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(keyId, b);
    return { ok: false, remaining: 0, retryAfter: Math.ceil(((1 - b.tokens) / perMinute) * 60) };
  }
  b.tokens -= 1;
  buckets.set(keyId, b);
  return { ok: true, remaining: Math.floor(b.tokens), retryAfter: 0 };
}
