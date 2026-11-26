import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { billingEvents, orgMembers, organizations } from "@/db/schema";
import { PLANS, billingState, checkSeat, quote, suggestPlan, type BillingFields } from "@/lib/billing-rules";
import { isPlatformAdmin } from "@/lib/platform";
import { requireOrgPermission } from "@/lib/rbac";
import { applySubscription, assertSeatAvailable, getBillingOverview, handlePolarWebhook, setSupportAccess, simulateBilling, syncSeats } from "@/server/services/billing";
import { signPolarWebhook, verifyPolarWebhook } from "@/server/services/polar";
import { listCompanies, platformAction, platformTotals, provisionCompany } from "@/server/services/platform-admin";
import { acceptInvite, changeMemberRole, createInvite, removeMember } from "@/server/services/workspace";
import { createTask } from "@/server/services/tasks";
import { switchDemoRole } from "@/server/services/demo";
import { addMember, makeTenant, makeUser, testDb } from "./helpers";
import type { DB } from "@/db";

const DAY = 86_400_000;
const at = (base: Date, days: number) => new Date(base.getTime() + days * DAY);
const NOW = new Date("2026-11-26T12:00:00Z");
const base: BillingFields = {
  isDemo: false, plan: "trial", billingStatus: "trialing", trialEndsAt: at(NOW, 10), currentPeriodEnd: null,
  cancelAtPeriodEnd: false, graceEndsAt: null, suspendedAt: null, createdAt: at(NOW, -4),
};

describe("billing lifecycle (pure)", () => {
  it("trial: full, then a warning in the last 3 days, then read-only for 14 days, then locked", () => {
    expect(billingState(base, NOW)).toMatchObject({ access: "full", phase: "trial", message: null });
    expect(billingState({ ...base, trialEndsAt: at(NOW, 2) }, NOW).message).toMatch(/ends in 2 days/);
    expect(billingState({ ...base, trialEndsAt: at(NOW, -1) }, NOW)).toMatchObject({ access: "read_only", phase: "read_only" });
    const locked = billingState({ ...base, trialEndsAt: at(NOW, -15) }, NOW);
    expect(locked).toMatchObject({ access: "locked", phase: "locked" });
    expect(locked.deleteAfter!.getTime()).toBe(at(NOW, -15 + 14 + 90).getTime());
    // A workspace without an explicit trial end gets 14 days from creation.
    expect(billingState({ ...base, trialEndsAt: null, createdAt: at(NOW, -20) }, NOW).access).toBe("read_only");
  });

  it("failed payment: 7-day grace with full access, then read-only, then locked", () => {
    const due = { ...base, plan: "team" as const, billingStatus: "past_due" as const };
    expect(billingState({ ...due, graceEndsAt: at(NOW, 5) }, NOW)).toMatchObject({ access: "full", phase: "grace" });
    expect(billingState({ ...due, graceEndsAt: at(NOW, -3) }, NOW).access).toBe("read_only");
    expect(billingState({ ...due, graceEndsAt: at(NOW, -15) }, NOW).access).toBe("locked");
  });

  it("canceled keeps access until the paid period ends; suspension locks immediately; comped and demo are always full", () => {
    const paid = { ...base, plan: "team" as const, billingStatus: "active" as const, currentPeriodEnd: at(NOW, 30) };
    expect(billingState(paid, NOW)).toMatchObject({ access: "full", phase: "active" });
    expect(billingState({ ...paid, cancelAtPeriodEnd: true }, NOW)).toMatchObject({ access: "full", phase: "ending" });
    expect(billingState({ ...paid, cancelAtPeriodEnd: true, currentPeriodEnd: at(NOW, -1) }, NOW).access).toBe("read_only");
    expect(billingState({ ...paid, billingStatus: "canceled", currentPeriodEnd: at(NOW, -20) }, NOW).access).toBe("locked");
    expect(billingState({ ...paid, billingStatus: "suspended", suspendedAt: NOW }, NOW)).toMatchObject({ access: "locked", phase: "suspended" });
    expect(billingState({ ...base, plan: "comped", billingStatus: "active", trialEndsAt: at(NOW, -100) }, NOW).access).toBe("full");
    expect(billingState({ ...base, isDemo: true, trialEndsAt: at(NOW, -100) }, NOW).access).toBe("full");
  });

  it("prices and plan fit", () => {
    expect(quote("team", 10)).toEqual({ seats: 10, monthly: 35, perPeriod: 420 });
    expect(quote("team", 2).seats).toBe(5); // plan minimum
    expect(quote("payg", 10).monthly).toBe(50);
    expect(quote("business", 100).monthly).toBe(300);
    expect([suggestPlan(12), suggestPlan(50), suggestPlan(51), suggestPlan(101)]).toEqual(["team", "team", "business", null]);
    expect(PLANS.team.maxSeats).toBe(50);
  });

  it("seat limit: over the plan is allowed for 7 days, then refused", () => {
    expect(checkSeat("team", 49, null, NOW)).toEqual({ ok: true, overLimit: false });
    expect(checkSeat("team", 50, null, NOW)).toEqual({ ok: true, overLimit: true });
    expect(checkSeat("team", 50, at(NOW, -3), NOW)).toEqual({ ok: true, overLimit: true });
    expect(checkSeat("team", 50, at(NOW, -8), NOW)).toMatchObject({ ok: false });
    expect(checkSeat("payg", 5000, null, NOW)).toEqual({ ok: true, overLimit: false });
  });
});

let db: DB;
beforeAll(async () => {
  db = await testDb();
});

describe("access guard follows billing", () => {
  it("read-only: everyone can read, nobody can write; admins can still manage people and billing", async () => {
    const T = await makeTenant("ReadOnly");
    await db.update(organizations).set({ trialEndsAt: new Date(Date.now() - DAY) }).where(eq(organizations.id, T.org.id));
    await expect(requireOrgPermission(T.viewer.id, T.org.id, "viewer", db)).resolves.toBe("viewer");
    await expect(createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Blocked" })).rejects.toMatchObject({ code: "WORKSPACE_READ_ONLY" });
    await expect(changeMemberRole(db, T.admin.id, { organizationId: T.org.id, userId: T.member.id, role: "viewer" })).resolves.toMatchObject({ to: "viewer" });
    await expect(getBillingOverview(db, T.admin.id, T.org.id)).resolves.toMatchObject({ state: { access: "read_only" } });
    await expect(getBillingOverview(db, T.member.id, T.org.id)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
  });

  it("locked: reads are refused too, except billing for admins", async () => {
    const T = await makeTenant("Locked");
    await db.update(organizations).set({ billingStatus: "suspended", suspendedAt: new Date(), suspendedReason: "Unpaid invoice" }).where(eq(organizations.id, T.org.id));
    await expect(requireOrgPermission(T.member.id, T.org.id, "viewer", db)).rejects.toMatchObject({ code: "WORKSPACE_LOCKED" });
    await expect(requireOrgPermission(T.admin.id, T.org.id, "viewer", db)).rejects.toMatchObject({ code: "WORKSPACE_LOCKED" });
    await expect(getBillingOverview(db, T.admin.id, T.org.id)).resolves.toMatchObject({ state: { phase: "suspended" } });
  });

  it("demo workspaces are never billed; demo role switching can't grant the legacy owner role", async () => {
    const T = await makeTenant("DemoSkip");
    await db.update(organizations).set({ isDemo: true, trialEndsAt: new Date(Date.now() - 100 * DAY) }).where(eq(organizations.id, T.org.id));
    await expect(createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Fine" })).resolves.toBeTruthy();
    await expect(switchDemoRole(db, T.member.id, T.org.id, "owner")).rejects.toThrow();
  });
});

describe("seats", () => {
  it("viewers are free; going over the plan starts a 7-day grace; after it, paid invites are refused; removing people clears it", async () => {
    const T = await makeTenant("Seats"); // creator(admin) + admin + member billable, viewer free
    await db.update(organizations).set({ plan: "team", billingStatus: "active" }).where(eq(organizations.id, T.org.id));
    for (let i = 0; i < 47; i++) await addMember(T.org.id, (await makeUser(`Seat${i}`)).id, "member"); // 50 billable
    const extra = await makeUser("Fiftyone");
    const inv = await createInvite(db, T.admin.id, { organizationId: T.org.id, email: extra.email, role: "member" });
    await acceptInvite(db, extra.id, inv.token); // 51st: allowed, grace starts
    const [o1] = await db.select().from(organizations).where(eq(organizations.id, T.org.id));
    expect(o1!.seatOverageSince).not.toBeNull();
    await expect(createInvite(db, T.admin.id, { organizationId: T.org.id, email: "free-viewer@x.io", role: "viewer" })).resolves.toBeTruthy(); // viewers are free
    await db.update(organizations).set({ seatOverageSince: new Date(Date.now() - 8 * DAY) }).where(eq(organizations.id, T.org.id));
    await expect(createInvite(db, T.admin.id, { organizationId: T.org.id, email: "late@x.io", role: "member" })).rejects.toMatchObject({ code: "SEAT_LIMIT" });
    await expect(changeMemberRole(db, T.admin.id, { organizationId: T.org.id, userId: T.viewer.id, role: "member" })).rejects.toMatchObject({ code: "SEAT_LIMIT" });
    await removeMember(db, T.admin.id, T.org.id, extra.id);
    await syncSeats(db, T.org.id);
    const [o2] = await db.select().from(organizations).where(eq(organizations.id, T.org.id));
    expect(o2!.seatOverageSince).toBeNull();
    await expect(assertSeatAvailable(db, T.org.id)).resolves.toBeUndefined();
  });
});

describe("Polar webhooks", () => {
  const SECRET = "whsec_" + Buffer.from("test-signing-secret-123456").toString("base64");
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.POLAR_PRODUCT_TEAM = "prod_team";
    process.env.POLAR_PRODUCT_PAYG = "prod_payg";
    process.env.POLAR_PRODUCT_BUSINESS = "prod_business";
  });
  afterAll(() => {
    process.env = saved;
  });
  const send = (body: object, id = crypto.randomUUID(), ts = Math.floor(Date.now() / 1000), secret = SECRET) => {
    const raw = JSON.stringify(body);
    const headers = new Headers({ "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": signPolarWebhook(raw, id, ts, secret) });
    return handlePolarWebhook(db, raw, headers, SECRET);
  };
  const sub = (orgId: string, over: Record<string, unknown> = {}) => ({
    id: "sub_1", status: "active", current_period_end: new Date(Date.now() + 365 * DAY).toISOString(), cancel_at_period_end: false, ended_at: null,
    product_id: "prod_team", customer_id: "cus_1", seats: 12, metadata: { organizationId: orgId }, customer: { id: "cus_1", external_id: orgId }, ...over,
  });

  it("verifies Standard Webhooks signatures, rejects tampering and stale timestamps", () => {
    const raw = '{"a":1}';
    const ts = Math.floor(Date.now() / 1000);
    const h = (sig: string, t = ts) => new Headers({ "webhook-id": "msg_1", "webhook-timestamp": String(t), "webhook-signature": sig });
    const good = signPolarWebhook(raw, "msg_1", ts, SECRET);
    expect(verifyPolarWebhook(raw, h(good), SECRET)).toBe(true);
    expect(verifyPolarWebhook(raw, h(`v1,bogus ${good}`), SECRET)).toBe(true); // any listed signature may match
    expect(verifyPolarWebhook(raw + " ", h(good), SECRET)).toBe(false);
    expect(verifyPolarWebhook(raw, h(signPolarWebhook(raw, "msg_1", ts - 600, SECRET), ts - 600), SECRET)).toBe(false);
    expect(verifyPolarWebhook(raw, h(good), "whsec_" + Buffer.from("other").toString("base64"))).toBe(false);
  });

  it("activation, failed payment, recovery and cancellation drive the lifecycle; duplicates are ignored", async () => {
    const T = await makeTenant("Polar");
    const bad = await handlePolarWebhook(db, "{}", new Headers({ "webhook-id": "x", "webhook-timestamp": "1", "webhook-signature": "v1,x" }), SECRET);
    expect(bad.status).toBe(403);

    const id = crypto.randomUUID();
    expect((await send({ type: "subscription.active", data: sub(T.org.id) }, id)).body).toBe("ok");
    expect((await send({ type: "subscription.active", data: sub(T.org.id) }, id)).body).toBe("duplicate");
    let [o] = await db.select().from(organizations).where(eq(organizations.id, T.org.id));
    expect(o).toMatchObject({ plan: "team", billingStatus: "active", seatsPurchased: 12, polarSubscriptionId: "sub_1", polarCustomerId: "cus_1" });

    await send({ type: "subscription.past_due", data: sub(T.org.id, { status: "past_due" }) });
    [o] = await db.select().from(organizations).where(eq(organizations.id, T.org.id));
    expect(o!.billingStatus).toBe("past_due");
    expect(o!.graceEndsAt!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(billingState(o!).phase).toBe("grace");

    await send({ type: "subscription.active", data: sub(T.org.id) });
    [o] = await db.select().from(organizations).where(eq(organizations.id, T.org.id));
    expect(o).toMatchObject({ billingStatus: "active", graceEndsAt: null });

    await send({ type: "subscription.revoked", data: sub(T.org.id, { status: "canceled", ended_at: new Date().toISOString() }) });
    [o] = await db.select().from(organizations).where(eq(organizations.id, T.org.id));
    expect(billingState(o!).access).toBe("read_only");
    const log = await db.select().from(billingEvents).where(eq(billingEvents.organizationId, T.org.id));
    expect(log.filter((e) => e.type === "lifecycle").length).toBe(4);
  });

  it("a manual suspension is never lifted by a payment event; unknown workspaces are acknowledged and ignored", async () => {
    const T = await makeTenant("Manual");
    await db.update(organizations).set({ billingStatus: "suspended", suspendedAt: new Date() }).where(eq(organizations.id, T.org.id));
    await send({ type: "subscription.active", data: sub(T.org.id) });
    const [o] = await db.select().from(organizations).where(eq(organizations.id, T.org.id));
    expect(o!.billingStatus).toBe("suspended");
    expect((await send({ type: "subscription.active", data: sub("00000000-0000-4000-8000-000000000000") })).body).toBe("no matching workspace");
  });

  it("dev simulator runs the same code path", async () => {
    const T = await makeTenant("Sim");
    await simulateBilling(db, T.admin.id, T.org.id, "subscribe_business");
    let [o] = await db.select().from(organizations).where(eq(organizations.id, T.org.id));
    expect(o).toMatchObject({ plan: "business", billingStatus: "active", seatsPurchased: 51 });
    await simulateBilling(db, T.admin.id, T.org.id, "payment_failed");
    await simulateBilling(db, T.admin.id, T.org.id, "expire_grace");
    [o] = await db.select().from(organizations).where(eq(organizations.id, T.org.id));
    expect(billingState(o!).access).toBe("read_only");
    await expect(simulateBilling(db, T.member.id, T.org.id, "subscribe_team")).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    void applySubscription;
  });
});

describe("platform owner", () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env = saved;
  });

  it("is recognised by user id, or by email (verified emails only in production)", () => {
    process.env.PLATFORM_ADMIN_USER_IDS = "11111111-1111-4111-8111-111111111111";
    process.env.PLATFORM_ADMIN_EMAILS = "boss@vendor.io";
    expect(isPlatformAdmin({ id: "11111111-1111-4111-8111-111111111111", email: "x@y.z" })).toBe(true);
    expect(isPlatformAdmin({ id: "u2", email: "BOSS@vendor.io", emailVerified: false })).toBe(true); // dev/test
    const env = process.env as Record<string, string>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = "production";
    expect(isPlatformAdmin({ id: "u2", email: "boss@vendor.io", emailVerified: false })).toBe(false);
    expect(isPlatformAdmin({ id: "u2", email: "boss@vendor.io", emailVerified: true })).toBe(true);
    env.NODE_ENV = prev!;
    expect(isPlatformAdmin({ id: "u3", email: "someone@else.io" })).toBe(false);
  });

  it("provisions a company (not as a member), acts on billing, and never reads customer work without support access", async () => {
    const boss = await makeUser("Vendor");
    const stranger = await makeUser("Stranger");
    process.env.PLATFORM_ADMIN_USER_IDS = boss.id;
    await expect(listCompanies(db, stranger.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { organizationId, token } = await provisionCompany(db, boss.id, { name: "Globex Corp", adminEmail: "ceo@globex.io" });
    const ceo = await makeUser("Ceo");
    await db.update((await import("@/db/schema")).users).set({ email: "ceo@globex.io" }).where(eq((await import("@/db/schema")).users.id, ceo.id));
    await acceptInvite(db, ceo.id, token);
    await expect(requireOrgPermission(ceo.id, organizationId, "admin", db)).resolves.toBe("admin");
    const members = await db.select().from(orgMembers).where(eq(orgMembers.organizationId, organizationId));
    expect(members.map((m) => m.userId)).toEqual([ceo.id]); // the vendor isn't in it

    // No peeking without permission; read-only while the company's admin allows it.
    await expect(requireOrgPermission(boss.id, organizationId, "viewer", db)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    await setSupportAccess(db, ceo.id, organizationId, 24);
    await expect(requireOrgPermission(boss.id, organizationId, "viewer", db)).resolves.toBe("viewer");
    await expect(requireOrgPermission(boss.id, organizationId, "member", db)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    await expect(requireOrgPermission(stranger.id, organizationId, "viewer", db)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    await setSupportAccess(db, ceo.id, organizationId, 0);
    await expect(requireOrgPermission(boss.id, organizationId, "viewer", db)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });

    await expect(platformAction(db, boss.id, organizationId, { action: "suspend" })).rejects.toMatchObject({ code: "VALIDATION" });
    await platformAction(db, boss.id, organizationId, { action: "suspend", reason: "Invoice #12 unpaid" });
    await expect(requireOrgPermission(ceo.id, organizationId, "viewer", db)).rejects.toMatchObject({ code: "WORKSPACE_LOCKED" });
    await platformAction(db, boss.id, organizationId, { action: "reactivate" });
    await expect(requireOrgPermission(ceo.id, organizationId, "viewer", db)).resolves.toBe("admin");
    await platformAction(db, boss.id, organizationId, { action: "comp" });
    await expect(platformAction(db, boss.id, organizationId, { action: "cancel_now" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(platformAction(db, stranger.id, organizationId, { action: "comp" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const rows = await listCompanies(db, boss.id);
    const globex = rows.find((r) => r.id === organizationId)!;
    expect(globex).toMatchObject({ plan: "comped", billable: 1, admins: ["ceo@globex.io"] });
    expect(platformTotals(rows).companies).toBeGreaterThan(0);
    const log = await db.select().from(billingEvents).where(eq(billingEvents.organizationId, organizationId));
    expect(log.map((l) => l.type)).toEqual(expect.arrayContaining(["platform.provision", "platform.suspend", "platform.reactivate", "platform.comp"]));
  });
});
