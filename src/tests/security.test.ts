import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, orgMembers, organizations, ssoProviders, users } from "@/db/schema";
import { ipAllowed, parseIp, validateAllowlist } from "@/lib/ip";
import { requireOrgPermission } from "@/lib/rbac";
import * as sec from "@/server/services/security";
import * as sso from "@/server/services/sso";
import { ssoProvisionUser, ssoRequiredFor } from "@/server/services/sso-hooks";
import * as scim from "@/server/services/scim";
import { makeTenant, makeUser, testDb } from "./helpers";
import type { DB } from "@/db";

// The guard reads the caller's IP through this module; tests choose it.
const ipState = vi.hoisted(() => ({ ip: undefined as string | null | undefined }));
vi.mock("@/lib/request-ip", () => ({ currentRequestIp: async () => ipState.ip }));
// Test identity providers live on example domains that don't resolve; the SSRF check has its own tests.
vi.mock("@/server/services/webhooks", async (orig) => ({ ...(await orig<object>()), assertSafeUrl: async (u: string) => new URL(u) }));

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;
const BASE = "https://app.example.com";

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Secure");
  Other = await makeTenant("Neighbour");
});

describe("IP allow-lists (pure)", () => {
  it("parses v4, v6 and mapped addresses", () => {
    expect(parseIp("10.1.2.3")?.v).toBe(4);
    expect(parseIp("2001:db8::1")?.v).toBe(6);
    expect(parseIp("::ffff:10.1.2.3")).toEqual(parseIp("10.1.2.3"));
    expect(parseIp("999.1.1.1")).toBeNull();
    expect(parseIp("not-an-ip")).toBeNull();
  });
  it("matches single addresses and CIDR ranges; empty list allows all", () => {
    const list = "203.0.113.7\n10.0.0.0/8 # office\n2001:db8::/32";
    expect(ipAllowed("203.0.113.7", list)).toBe(true);
    expect(ipAllowed("203.0.113.8", list)).toBe(false);
    expect(ipAllowed("10.200.3.4", list)).toBe(true);
    expect(ipAllowed("11.0.0.1", list)).toBe(false);
    expect(ipAllowed("2001:db8:abcd::5", list)).toBe(true);
    expect(ipAllowed("2001:db9::5", list)).toBe(false);
    expect(ipAllowed(null, list)).toBe(false);
    expect(ipAllowed("1.2.3.4", "")).toBe(true);
  });
  it("validates and reports the first bad line", () => {
    expect(validateAllowlist("10.0.0.0/8\n\n# note\n1.2.3.4")).toEqual({ ok: true, cleaned: "10.0.0.0/8\n1.2.3.4", count: 2 });
    expect(validateAllowlist("10.0.0.0/33")).toEqual({ ok: false, line: "10.0.0.0/33" });
    expect(validateAllowlist("hello")).toEqual({ ok: false, line: "hello" });
  });
});

describe("workspace security policy in the guard", () => {
  it("require 2FA: admin must have it first; then people without it are refused", async () => {
    await expect(sec.setRequire2fa(db, T.owner.id, T.org.id, true)).rejects.toThrow(/your own account first/);
    await db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, T.owner.id));
    await sec.setRequire2fa(db, T.owner.id, T.org.id, true);
    await expect(requireOrgPermission(T.member.id, T.org.id, "member", db)).rejects.toMatchObject({ code: "TWO_FACTOR_REQUIRED" });
    expect(await requireOrgPermission(T.owner.id, T.org.id, "admin", db)).toBeTruthy();
    await db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, T.member.id));
    expect(await requireOrgPermission(T.member.id, T.org.id, "member", db)).toBe("member");
    // Other workspaces are unaffected.
    expect(await requireOrgPermission(Other.member.id, Other.org.id, "member", db)).toBe("member");
    const s = await sec.getSecuritySettings(db, T.owner.id, T.org.id);
    expect(s.without2fa.map((p) => p.userId)).toEqual(expect.arrayContaining([T.admin.id, T.viewer.id]));
    await sec.setRequire2fa(db, T.owner.id, T.org.id, false);
    await expect(sec.setRequire2fa(db, T.member.id, T.org.id, false)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
  });

  it("IP allow-list: refuses saving a list that locks the admin out, then enforces it per request", async () => {
    await expect(sec.setIpAllowlist(db, T.owner.id, T.org.id, "10.0.0.0/8", "203.0.113.9")).rejects.toThrow(/lock you out/);
    await expect(sec.setIpAllowlist(db, T.owner.id, T.org.id, "10.0.0.0/99", "10.0.0.1")).rejects.toThrow(/isn't an IP/);
    await sec.setIpAllowlist(db, T.owner.id, T.org.id, "10.0.0.0/8", "10.1.1.1");
    ipState.ip = "203.0.113.9";
    await expect(requireOrgPermission(T.member.id, T.org.id, "viewer", db)).rejects.toMatchObject({ code: "IP_NOT_ALLOWED" });
    ipState.ip = "10.9.9.9";
    expect(await requireOrgPermission(T.member.id, T.org.id, "viewer", db)).toBe("member");
    ipState.ip = undefined; // no request (scheduler): not applicable
    expect(await requireOrgPermission(T.member.id, T.org.id, "viewer", db)).toBe("member");
    ipState.ip = "10.1.1.1";
    await sec.setIpAllowlist(db, T.owner.id, T.org.id, "", "10.1.1.1");
    ipState.ip = "203.0.113.9";
    expect(await requireOrgPermission(T.member.id, T.org.id, "viewer", db)).toBe("member");
    ipState.ip = undefined;
  });
});

describe("audit retention and exports", () => {
  it("purges entries older than the workspace's retention (never under 90 days)", async () => {
    await expect(sec.setAuditRetention(db, T.owner.id, T.org.id, 30)).rejects.toThrow(/at least 90/);
    await sec.setAuditRetention(db, T.owner.id, T.org.id, 90);
    const old = new Date(Date.now() - 120 * 86_400_000);
    await db.insert(auditLogs).values({ organizationId: T.org.id, actorId: T.owner.id, action: "OLD_THING", entityType: "task", entityId: T.task.id, metadata: {}, createdAt: old });
    await db.insert(auditLogs).values({ organizationId: Other.org.id, actorId: Other.owner.id, action: "OLD_THING", entityType: "task", entityId: Other.task.id, metadata: {}, createdAt: old });
    expect(await sec.purgeAuditLogs(db)).toBe(1);
    const left = await db.select().from(auditLogs).where(eq(auditLogs.action, "OLD_THING"));
    expect(left.map((l) => l.organizationId)).toEqual([Other.org.id]); // other tenant keeps everything
  });

  it("audit CSV is admin-only and neutralises formulas", async () => {
    await expect(sec.exportAuditCsv(db, T.member.id, T.org.id, {})).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await db.insert(auditLogs).values({ organizationId: T.org.id, actorId: T.owner.id, action: "=HYPERLINK(1)", entityType: "task", entityId: T.task.id, metadata: {} });
    const csv = await sec.exportAuditCsv(db, T.owner.id, T.org.id, {});
    expect(csv.split("\n")[0]).toContain("time (UTC)");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it("workspace export holds the tenant's data and none of its secrets", async () => {
    const data = await sec.exportWorkspace(db, T.owner.id, T.org.id);
    expect(data.tasks.every((t) => t.organizationId === T.org.id)).toBe(true);
    expect(data.projects.map((p) => p.id)).toContain(T.project.id);
    const text = JSON.stringify(data);
    expect(text).not.toContain(Other.org.id);
    expect(text).not.toMatch(/keyHash|secretHash|tokenHash|scimTokenHash|password/);
    await expect(sec.exportWorkspace(db, T.member.id, T.org.id)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
  });
});

describe("single sign-on and SCIM", () => {
  const register = (rows: DB) => async (body: Record<string, unknown>) => {
    // Stand-in for Better Auth's registerSSOProvider: store the row the way the plugin does.
    await rows.insert(ssoProviders).values({ providerId: String(body.providerId), issuer: String(body.issuer), domain: String(body.domain), oidcConfig: JSON.stringify(body.oidcConfig ?? null), samlConfig: body.samlConfig ? JSON.stringify(body.samlConfig) : null });
  };

  it("validates domains, links the provider to the workspace, and needs DNS proof", async () => {
    const input = { kind: "oidc" as const, domains: "secure.example", issuer: "https://idp.example", clientId: "cid", clientSecret: "shh" };
    await expect(sso.saveSso(db, T.owner.id, T.org.id, { ...input, domains: "gmail.com" }, BASE, register(db))).rejects.toThrow(/public email/);
    await expect(sso.saveSso(db, T.member.id, T.org.id, input, BASE, register(db))).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await sso.saveSso(db, T.owner.id, T.org.id, input, BASE, register(db));
    const got = await sso.getSso(db, T.owner.id, T.org.id, BASE);
    expect(got.provider).toMatchObject({ kind: "oidc", verified: false, domains: ["secure.example"], clientId: "cid" });
    expect(JSON.stringify(got)).not.toContain("shh");
    const record = got.provider!.records[0]!;
    await expect(sso.verifySsoDomains(db, T.owner.id, T.org.id, async () => [["wrong"]])).rejects.toThrow(/No matching TXT/);
    await expect(sso.setSsoRequired(db, T.owner.id, T.org.id, true)).rejects.toThrow(/Verify your domain/);
    await sso.verifySsoDomains(db, T.owner.id, T.org.id, async (host) => (host === record.host ? [[record.value.slice(0, 10), record.value.slice(10)]] : []));
    expect((await sso.getSso(db, T.owner.id, T.org.id, BASE)).provider!.verified).toBe(true);
    // Another workspace can't claim the same verified domain.
    await expect(sso.saveSso(db, Other.owner.id, Other.org.id, input, BASE, register(db))).rejects.toThrow(/already verified/);
  });

  it("SSO sign-in adds people on the domain as members; 'require SSO' targets that domain only", async () => {
    const [alice] = await db.insert(users).values({ name: "Alice Corp", email: "alice@secure.example" }).returning();
    const [outsider] = await db.insert(users).values({ name: "Out Sider", email: "out@elsewhere.example" }).returning();
    const providerId = sso.providerIdFor(T.org.id);
    await ssoProvisionUser({ user: alice!, provider: { providerId } });
    await ssoProvisionUser({ user: alice!, provider: { providerId } }); // idempotent
    await ssoProvisionUser({ user: outsider!, provider: { providerId } });
    const members = await db.select().from(orgMembers).where(eq(orgMembers.organizationId, T.org.id));
    expect(members.filter((m) => m.userId === alice!.id)).toHaveLength(1);
    expect(members.find((m) => m.userId === alice!.id)?.role).toBe("member");
    expect(members.some((m) => m.userId === outsider!.id)).toBe(false);

    expect(await ssoRequiredFor(alice!.id)).toBeNull();
    await sso.setSsoRequired(db, T.owner.id, T.org.id, true);
    expect(await ssoRequiredFor(alice!.id)).toBe(T.org.name);
    expect(await ssoRequiredFor(outsider!.id)).toBeNull();
    await sso.removeSso(db, T.owner.id, T.org.id);
    const [o] = await db.select().from(organizations).where(eq(organizations.id, T.org.id));
    expect(o!.ssoRequired).toBe(false);
    expect(await ssoRequiredFor(alice!.id)).toBeNull();
  });

  it("SCIM: token auth, create / find / deactivate, tenant-scoped, last admin protected", async () => {
    await expect(scim.orgForScimToken(db, "Bearer nope")).rejects.toMatchObject({ status: 401 });
    const token = await sso.rotateScimToken(db, T.owner.id, T.org.id);
    expect(await scim.orgForScimToken(db, `Bearer ${token}`)).toBe(T.org.id);
    const created = await scim.createUser(db, T.org.id, { userName: "Bob.New@Secure.example", name: { givenName: "Bob", familyName: "New" } }, BASE);
    expect(created).toMatchObject({ userName: "bob.new@secure.example", displayName: "Bob New", active: true });
    await expect(scim.createUser(db, T.org.id, { userName: "bob.new@secure.example" }, BASE)).rejects.toMatchObject({ status: 409 });
    const list = await scim.listUsers(db, T.org.id, { filter: 'userName eq "bob.new@secure.example"' }, BASE);
    expect(list.totalResults).toBe(1);
    await expect(scim.listUsers(db, T.org.id, { filter: 'name co "x"' }, BASE)).rejects.toMatchObject({ status: 400 });
    // Another tenant's token can't see this person.
    const otherToken = await sso.rotateScimToken(db, Other.owner.id, Other.org.id);
    const otherOrg = await scim.orgForScimToken(db, `Bearer ${otherToken}`);
    await expect(scim.getUser(db, otherOrg, created.id, BASE)).rejects.toMatchObject({ status: 404 });
    // Entra-style PATCH deactivation removes them from this workspace only.
    const off = await scim.updateUser(db, T.org.id, created.id, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "Replace", path: "active", value: "False" }] }, "patch", BASE);
    expect(off.active).toBe(false);
    await expect(scim.getUser(db, T.org.id, created.id, BASE)).rejects.toMatchObject({ status: 404 });
    const [still] = await db.select().from(users).where(eq(users.id, created.id));
    expect(still).toBeTruthy();
    // The last admin can't be deprovisioned.
    const solo = await makeTenant("Solo");
    await db.delete(orgMembers).where(eq(orgMembers.userId, solo.admin.id));
    await db.update(orgMembers).set({ role: "admin" }).where(eq(orgMembers.userId, solo.owner.id));
    await expect(scim.deleteUser(db, solo.org.id, solo.owner.id)).rejects.toMatchObject({ status: 409 });
    await sso.disableScim(db, T.owner.id, T.org.id);
    await expect(scim.orgForScimToken(db, `Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
    void makeUser;
  });
});
