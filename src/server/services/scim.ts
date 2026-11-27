import { and, asc, count, eq, ilike, ne } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, orgMembers, organizations, users } from "@/db/schema";
import { assertSeatAvailable, syncSeats } from "./billing";
import { hashToken } from "./sso";

/**
 * SCIM 2.0 (RFC 7643/7644) user provisioning, the subset identity providers use:
 * Okta, Microsoft Entra ID, OneLogin and JumpCloud create, update, deactivate and delete
 * users here, and the workspace follows. Deactivating or deleting removes the person
 * from this workspace only; their account and other workspaces are untouched.
 */

export const SCIM_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

export class ScimError extends Error {
  constructor(public status: number, message: string, public scimType?: string) {
    super(message);
  }
  body() {
    return { schemas: [ERROR], status: String(this.status), detail: this.message, ...(this.scimType ? { scimType: this.scimType } : {}) };
  }
}

export async function orgForScimToken(conn: DB, authorization: string | null) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new ScimError(401, "Missing bearer token");
  const [o] = await conn.select({ id: organizations.id, isDemo: organizations.isDemo }).from(organizations).where(eq(organizations.scimTokenHash, hashToken(token))).limit(1);
  if (!o) throw new ScimError(401, "Invalid token");
  return o.id;
}

type Row = { id: string; email: string; name: string; createdAt: Date; updatedAt: Date; member: boolean };
export function toScim(u: Row, baseUrl: string) {
  const [givenName, ...rest] = u.name.split(" ");
  return {
    schemas: [SCIM_USER],
    id: u.id,
    userName: u.email,
    name: { formatted: u.name, givenName: givenName ?? "", familyName: rest.join(" ") },
    displayName: u.name,
    emails: [{ value: u.email, type: "work", primary: true }],
    active: u.member,
    meta: { resourceType: "User", created: u.createdAt.toISOString(), lastModified: u.updatedAt.toISOString(), location: `${baseUrl}/api/scim/v2/Users/${u.id}` },
  };
}

const memberRows = (conn: DB, organizationId: string) =>
  conn
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt, updatedAt: users.updatedAt })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(eq(orgMembers.organizationId, organizationId));

export async function listUsers(conn: DB, organizationId: string, q: { filter?: string | null; startIndex?: number; count?: number }, baseUrl: string) {
  const start = Math.max(1, q.startIndex ?? 1);
  const size = Math.min(200, Math.max(0, q.count ?? 100));
  let emailFilter: string | null = null;
  if (q.filter) {
    const m = q.filter.match(/^\s*(userName|emails(?:\.value)?)\s+eq\s+"([^"]+)"\s*$/i);
    if (!m) throw new ScimError(400, "Only 'userName eq \"…\"' filters are supported", "invalidFilter");
    emailFilter = m[2]!.toLowerCase();
  }
  const where = and(eq(orgMembers.organizationId, organizationId), emailFilter ? ilike(users.email, emailFilter) : undefined);
  const [{ total }] = (await conn.select({ total: count() }).from(orgMembers).innerJoin(users, eq(users.id, orgMembers.userId)).where(where)) as [{ total: number }];
  const rows = await conn
    .select({ id: users.id, email: users.email, name: users.name, createdAt: users.createdAt, updatedAt: users.updatedAt })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(where)
    .orderBy(asc(users.email))
    .offset(start - 1)
    .limit(size);
  return { schemas: [LIST], totalResults: Number(total), startIndex: start, itemsPerPage: rows.length, Resources: rows.map((r) => toScim({ ...r, member: true }, baseUrl)) };
}

async function getRow(conn: DB, organizationId: string, id: string): Promise<Row> {
  if (!z.string().uuid().safeParse(id).success) throw new ScimError(404, "User not found");
  const [u] = await memberRows(conn, organizationId).then((rows) => rows.filter((r) => r.id === id));
  if (!u) throw new ScimError(404, "User not found");
  return { ...u, member: true };
}

export async function getUser(conn: DB, organizationId: string, id: string, baseUrl: string) {
  return toScim(await getRow(conn, organizationId, id), baseUrl);
}

const userBody = z.object({
  userName: z.string().email().max(255),
  name: z.object({ formatted: z.string().optional(), givenName: z.string().optional(), familyName: z.string().optional() }).partial().optional(),
  displayName: z.string().max(120).optional(),
  emails: z.array(z.object({ value: z.string().email(), primary: z.boolean().optional() })).optional(),
  active: z.boolean().optional(),
});
const nameFrom = (b: z.infer<typeof userBody>) =>
  (b.displayName || b.name?.formatted || [b.name?.givenName, b.name?.familyName].filter(Boolean).join(" ") || b.userName.split("@")[0] || "New member").slice(0, 120);

async function audit(conn: DB, organizationId: string, action: string, userId: string, metadata: Record<string, unknown>) {
  await conn.insert(auditLogs).values({ organizationId, actorId: null, action, entityType: "user", entityId: userId, metadata: { via: "scim", ...metadata } });
}

export async function createUser(conn: DB, organizationId: string, raw: unknown, baseUrl: string) {
  const parsed = userBody.safeParse(raw);
  if (!parsed.success) throw new ScimError(400, parsed.error.issues.map((i) => i.message).join("; "), "invalidValue");
  const b = parsed.data;
  const email = b.userName.toLowerCase();
  if (b.active === false) throw new ScimError(400, "Creating an inactive user isn't supported", "invalidValue");
  let [u] = await conn.select().from(users).where(eq(users.email, email)).limit(1);
  if (u) {
    const [m] = await conn.select({ id: orgMembers.id }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, u.id))).limit(1);
    if (m) throw new ScimError(409, "A user with that userName already exists", "uniqueness");
  }
  try {
    await assertSeatAvailable(conn, organizationId);
  } catch (err) {
    throw new ScimError(403, err instanceof Error ? err.message : "No seats left on this plan");
  }
  if (!u) [u] = await conn.insert(users).values({ email, name: nameFrom(b), emailVerified: false }).returning();
  await conn.insert(orgMembers).values({ organizationId, userId: u!.id, role: "member" }).onConflictDoNothing();
  await audit(conn, organizationId, "MEMBER_PROVISIONED", u!.id, { email });
  await syncSeats(conn, organizationId).catch(() => undefined);
  return toScim({ ...u!, member: true }, baseUrl);
}

/** Remove from this workspace (never the last admin). */
async function deactivate(conn: DB, organizationId: string, userId: string) {
  const [m] = await conn.select({ role: orgMembers.role }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, userId))).limit(1);
  if (!m) return;
  if (m.role === "admin" || m.role === "owner") {
    const others = await conn.select({ id: orgMembers.id }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), ne(orgMembers.userId, userId), eq(orgMembers.role, "admin")));
    if (!others.length) throw new ScimError(409, "This is the workspace's last admin; make someone else admin first", "mutability");
  }
  await conn.delete(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, userId)));
  await audit(conn, organizationId, "MEMBER_DEPROVISIONED", userId, {});
  await syncSeats(conn, organizationId).catch(() => undefined);
}

export async function deleteUser(conn: DB, organizationId: string, id: string) {
  await getRow(conn, organizationId, id);
  await deactivate(conn, organizationId, id);
}

/** PUT (replace) and PATCH (Okta / Entra send both shapes). Only `active` and the name are applied. */
export async function updateUser(conn: DB, organizationId: string, id: string, raw: unknown, mode: "put" | "patch", baseUrl: string) {
  const row = await getRow(conn, organizationId, id);
  let active: boolean | undefined;
  let name: string | undefined;
  if (mode === "patch") {
    const body = z.object({ schemas: z.array(z.string()).optional(), Operations: z.array(z.object({ op: z.string(), path: z.string().optional(), value: z.unknown() })) }).safeParse(raw);
    if (!body.success) throw new ScimError(400, "Expected a SCIM PatchOp", "invalidSyntax");
    if (body.data.schemas && !body.data.schemas.includes(PATCH)) throw new ScimError(400, "Expected a SCIM PatchOp", "invalidSyntax");
    for (const op of body.data.Operations) {
      if (!/^(replace|add)$/i.test(op.op)) continue;
      const v = op.value as Record<string, unknown> | boolean | string;
      if (op.path === "active") active = v === true || v === "True" || v === "true";
      else if (op.path === "displayName" && typeof v === "string") name = v;
      else if (!op.path && v && typeof v === "object") {
        if ("active" in v) active = v.active === true || v.active === "True" || v.active === "true";
        if (typeof v.displayName === "string") name = v.displayName;
      }
    }
  } else {
    const parsed = userBody.safeParse(raw);
    if (!parsed.success) throw new ScimError(400, parsed.error.issues.map((i) => i.message).join("; "), "invalidValue");
    active = parsed.data.active ?? true;
    name = nameFrom(parsed.data);
  }
  if (name && name.trim() && name.trim() !== row.name) {
    await conn.update(users).set({ name: name.trim().slice(0, 120), updatedAt: new Date() }).where(eq(users.id, id));
    row.name = name.trim().slice(0, 120);
  }
  if (active === false) {
    await deactivate(conn, organizationId, id);
    return toScim({ ...row, member: false }, baseUrl);
  }
  return toScim(row, baseUrl);
}

export function serviceProviderConfig(baseUrl: string) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: `${baseUrl}/security`,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "Token from Settings › Security", primary: true }],
  };
}
