import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import { auditLogs, billingEvents, orgMembers, organizations, users, type Organization } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { GRACE_DAYS, PLANS, billingState, checkSeat, isBillableRole, type PlanId } from "@/lib/billing-rules";
import * as polar from "./polar";

/**
 * Billing for one company: plan, status, seats, checkout, customer portal, seat sync,
 * and turning payment-provider events into the lifecycle in src/lib/billing-rules.ts.
 */

const DAY = 86_400_000;
const BILLING = { billingExempt: true } as const;

export async function seatCounts(conn: DbOrTx, organizationId: string) {
  const rows = await conn
    .select({ role: orgMembers.role, n: sql<number>`count(*)::int` })
    .from(orgMembers)
    .where(eq(orgMembers.organizationId, organizationId))
    .groupBy(orgMembers.role);
  const billable = rows.filter((r) => isBillableRole(r.role)).reduce((s, r) => s + r.n, 0);
  const viewers = rows.filter((r) => r.role === "viewer").reduce((s, r) => s + r.n, 0);
  return { billable, viewers };
}

async function orgById(conn: DbOrTx, organizationId: string) {
  const [org] = await conn.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new AppError("NOT_FOUND", "Workspace not found");
  return org;
}

export async function logBillingEvent(
  conn: DbOrTx,
  e: { organizationId: string | null; source: "polar" | "platform" | "system" | "dev"; type: string; summary?: string; actorId?: string | null; externalId?: string | null; payload?: Record<string, unknown> }
) {
  const rows = await conn
    .insert(billingEvents)
    .values({ organizationId: e.organizationId, source: e.source, type: e.type, summary: e.summary?.slice(0, 300) ?? null, actorId: e.actorId ?? null, externalId: e.externalId ?? null, payload: e.payload ?? null })
    .onConflictDoNothing()
    .returning({ id: billingEvents.id });
  return rows.length > 0; // false = duplicate externalId (already processed)
}

/* ---------------------------------- overview ---------------------------------- */

export async function getBillingOverview(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, BILLING);
  const org = await orgById(conn, organizationId);
  const seats = await seatCounts(conn, organizationId);
  const events = await conn
    .select({ id: billingEvents.id, type: billingEvents.type, source: billingEvents.source, summary: billingEvents.summary, createdAt: billingEvents.createdAt })
    .from(billingEvents)
    .where(eq(billingEvents.organizationId, organizationId))
    .orderBy(desc(billingEvents.createdAt))
    .limit(15);
  const cfg = polar.polarConfig();
  return {
    org: pickBilling(org),
    state: billingState(org),
    seats: { ...seats, purchased: org.seatsPurchased, max: PLANS[org.plan].maxSeats },
    events,
    payments: { enabled: cfg.enabled, sandbox: cfg.sandbox, devSimulator: !cfg.enabled && process.env.NODE_ENV !== "production" },
  };
}

export function pickBilling(o: Organization) {
  return {
    plan: o.plan,
    billingStatus: o.billingStatus,
    trialEndsAt: o.trialEndsAt,
    currentPeriodEnd: o.currentPeriodEnd,
    cancelAtPeriodEnd: o.cancelAtPeriodEnd,
    graceEndsAt: o.graceEndsAt,
    suspendedAt: o.suspendedAt,
    suspendedReason: o.suspendedReason,
    seatsPurchased: o.seatsPurchased,
    seatOverageSince: o.seatOverageSince,
    hasSubscription: !!o.polarSubscriptionId,
    supportAccessUntil: o.supportAccessUntil,
  };
}

/* ---------------------------------- checkout ---------------------------------- */

export async function startCheckout(conn: DB, actorId: string, organizationId: string, plan: PlanId, appUrl: string) {
  z.enum(["payg", "team", "business"]).parse(plan);
  await requireOrgPermission(actorId, organizationId, "admin", conn, BILLING);
  const org = await orgById(conn, organizationId);
  if (org.isDemo) throw new AppError("VALIDATION", "Demo workspaces aren't billed");
  if (org.polarSubscriptionId && org.billingStatus !== "canceled") {
    throw new AppError("CONFLICT", "This workspace already has a subscription. Change the plan or seats from Manage billing.");
  }
  const cfg = polar.polarConfig();
  if (!cfg.enabled) throw new AppError("VALIDATION", "Payments aren't connected yet. Ask the SyncSprint team to finish setup.");
  const p = PLANS[plan];
  const { billable } = await seatCounts(conn, organizationId);
  if (p.maxSeats && billable > p.maxSeats) {
    throw new AppError("VALIDATION", `${p.name} covers up to ${p.maxSeats} people and you have ${billable}. Choose a bigger plan or make some people viewers (free).`);
  }
  const [me] = await conn.select({ email: users.email }).from(users).where(eq(users.id, actorId)).limit(1);
  const checkout = await polar.createCheckout({
    productId: cfg.products[plan]!,
    seats: Math.max(p.minSeats, billable),
    minSeats: Math.max(p.minSeats, billable),
    maxSeats: p.maxSeats,
    organizationId,
    email: me!.email,
    successUrl: `${appUrl}/w/${org.slug}/settings/billing?checkout_id={CHECKOUT_ID}`,
  });
  await logBillingEvent(conn, { organizationId, source: "system", type: "checkout.started", actorId, summary: `${p.name} checkout for ${Math.max(p.minSeats, billable)} seats` });
  return { url: checkout.url };
}

export async function openBillingPortal(conn: DB, actorId: string, organizationId: string, returnUrl: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, BILLING);
  const org = await orgById(conn, organizationId);
  if (!org.polarCustomerId && !org.polarSubscriptionId) throw new AppError("VALIDATION", "There's no subscription yet. Choose a plan first.");
  const s = await polar.createPortalSession(organizationId, returnUrl);
  return { url: s.customer_portal_url };
}

/* ------------------------------------ seats ------------------------------------ */

/**
 * Called (inside the membership transaction) before someone becomes billable.
 * Over the plan limit: allowed for 7 days with a prompt to upgrade, then refused.
 */
export async function assertSeatAvailable(conn: DbOrTx, organizationId: string) {
  const org = await orgById(conn, organizationId);
  if (org.isDemo) return;
  const { billable } = await seatCounts(conn, organizationId);
  const check = checkSeat(org.plan, billable, org.seatOverageSince);
  if (!check.ok) throw new AppError("SEAT_LIMIT", check.reason);
  if (check.overLimit && !org.seatOverageSince) {
    await conn.update(organizations).set({ seatOverageSince: new Date() }).where(eq(organizations.id, organizationId));
  }
}

/**
 * After membership changes: clear the over-limit flag when back within the plan, and
 * keep the subscription's seat count equal to billable people (never below the plan
 * minimum). Best effort: a provider hiccup is logged and retried on the next change.
 */
export async function syncSeats(conn: DB, organizationId: string) {
  const org = await orgById(conn, organizationId);
  if (org.isDemo) return;
  const { billable } = await seatCounts(conn, organizationId);
  const max = PLANS[org.plan].maxSeats;
  if (org.seatOverageSince && (max === null || billable <= max)) {
    await conn.update(organizations).set({ seatOverageSince: null }).where(eq(organizations.id, organizationId));
  }
  if (!org.polarSubscriptionId || !polar.polarConfig().enabled || !["payg", "team", "business"].includes(org.plan)) return;
  const want = Math.max(PLANS[org.plan].minSeats, Math.min(billable, max ?? billable));
  if (want === org.seatsPurchased) return;
  try {
    const sub = await polar.updateSeats(org.polarSubscriptionId, want);
    await conn.update(organizations).set({ seatsPurchased: sub.seats ?? want }).where(eq(organizations.id, organizationId));
    await logBillingEvent(conn, { organizationId, source: "system", type: "seats.updated", summary: `Seats ${org.seatsPurchased ?? "?"} → ${want}` });
  } catch (err) {
    await logBillingEvent(conn, { organizationId, source: "system", type: "seats.sync_failed", summary: err instanceof Error ? err.message : "Seat update failed" });
  }
}

/* ----------------------------- provider → lifecycle ----------------------------- */

/** Map a subscription snapshot onto the workspace. Manual suspensions are never lifted by a payment. */
export async function applySubscription(conn: DbOrTx, organizationId: string, sub: polar.PolarSubscription, eventType: string, planOverride?: PlanId) {
  const org = await orgById(conn, organizationId);
  const plan = planOverride ?? polar.planForProduct(sub.product_id) ?? org.plan;
  const keepSuspended = org.billingStatus === "suspended";
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : org.currentPeriodEnd;
  const ended = eventType === "subscription.revoked" || !!sub.ended_at || ((sub.status === "canceled" || sub.status === "incomplete_expired") && !sub.cancel_at_period_end);

  const patch: Partial<Organization> = {
    polarSubscriptionId: sub.id,
    polarCustomerId: sub.customer_id ?? org.polarCustomerId,
    seatsPurchased: sub.seats ?? org.seatsPurchased,
  };
  let summary: string;
  if (ended) {
    Object.assign(patch, { billingStatus: keepSuspended ? "suspended" : "canceled", currentPeriodEnd: sub.ended_at ? new Date(sub.ended_at) : new Date(), cancelAtPeriodEnd: false });
    summary = "Subscription ended";
  } else if (sub.status === "past_due" || sub.status === "unpaid") {
    Object.assign(patch, { billingStatus: keepSuspended ? "suspended" : "past_due", graceEndsAt: org.graceEndsAt ?? new Date(Date.now() + GRACE_DAYS * DAY), currentPeriodEnd: periodEnd });
    summary = `Payment failed. Grace period until ${(org.graceEndsAt ?? new Date(Date.now() + GRACE_DAYS * DAY)).toISOString().slice(0, 10)}`;
  } else if (sub.status === "active" || sub.status === "trialing") {
    Object.assign(patch, { plan, billingStatus: keepSuspended ? "suspended" : "active", graceEndsAt: null, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: sub.cancel_at_period_end });
    summary = sub.cancel_at_period_end ? `${PLANS[plan].name}: canceled, ends ${periodEnd?.toISOString().slice(0, 10) ?? "at period end"}` : `${PLANS[plan].name} active${sub.seats ? ` · ${sub.seats} seats` : ""}`;
  } else {
    summary = `Subscription ${sub.status}`;
  }
  await conn.update(organizations).set(patch).where(eq(organizations.id, organizationId));
  return summary;
}

export type WebhookResult = { status: number; body: string };

/** Verify, de-duplicate and apply one Polar webhook. Never throws for bad input. */
export async function handlePolarWebhook(conn: DB, rawBody: string, headers: Headers, secret = polar.polarConfig().webhookSecret): Promise<WebhookResult> {
  if (!secret) return { status: 503, body: "webhooks not configured" };
  if (!polar.verifyPolarWebhook(rawBody, headers, secret)) return { status: 403, body: "invalid signature" };
  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: "invalid json" };
  }
  const type = String(event.type ?? "");
  const data = (event.data ?? {}) as Record<string, unknown>;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const customer = (data.customer ?? {}) as { external_id?: string | null };
  const candidate = String(meta.organizationId ?? customer.external_id ?? "");
  const [org] = /^[0-9a-f-]{36}$/i.test(candidate) ? await conn.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, candidate)).limit(1) : [];

  return conn.transaction(async (tx) => {
    const fresh = await logBillingEvent(tx, {
      organizationId: org?.id ?? null,
      source: "polar",
      type,
      externalId: headers.get("webhook-id"),
      payload: { id: data.id, status: data.status, product_id: data.product_id, seats: data.seats },
      summary: type,
    });
    if (!fresh) return { status: 202, body: "duplicate" };
    if (!org) return { status: 202, body: "no matching workspace" };
    if (type.startsWith("subscription.")) {
      const summary = await applySubscription(tx, org.id, data as unknown as polar.PolarSubscription, type);
      await logBillingEvent(tx, { organizationId: org.id, source: "polar", type: "lifecycle", summary });
    }
    return { status: 202, body: "ok" };
  });
}

/* ------------------------------- dev simulator ------------------------------- */

export const SIMULATIONS = ["subscribe_payg", "subscribe_team", "subscribe_business", "payment_failed", "payment_recovered", "cancel_at_period_end", "subscription_ended", "expire_grace"] as const;

/**
 * Local development only (payments not connected): run the exact same lifecycle code
 * with a synthetic subscription, so every state can be tried without a card.
 */
export async function simulateBilling(conn: DB, actorId: string, organizationId: string, scenario: (typeof SIMULATIONS)[number]) {
  if (process.env.NODE_ENV === "production" || polar.polarConfig().enabled) throw new AppError("FORBIDDEN", "The billing simulator is only available in local development");
  z.enum(SIMULATIONS).parse(scenario);
  await requireOrgPermission(actorId, organizationId, "admin", conn, BILLING);
  const org = await orgById(conn, organizationId);
  const { billable } = await seatCounts(conn, organizationId);
  const plan: PlanId = scenario.startsWith("subscribe_") ? (scenario.slice(10) as PlanId) : org.plan === "trial" ? "team" : org.plan;
  const p = PLANS[plan];
  const now = Date.now();
  const sub: polar.PolarSubscription = {
    id: org.polarSubscriptionId ?? `sim_${organizationId.slice(0, 8)}`,
    status: "active",
    current_period_end: new Date(now + (p.interval === "year" ? 365 : 30) * DAY).toISOString(),
    cancel_at_period_end: false,
    ended_at: null,
    product_id: `sim_${plan}`,
    customer_id: org.polarCustomerId ?? `simcus_${organizationId.slice(0, 8)}`,
    seats: Math.max(p.minSeats, billable),
  };
  let type = "subscription.active";
  if (scenario === "payment_failed") (sub.status = "past_due"), (type = "subscription.past_due");
  if (scenario === "cancel_at_period_end") (sub.cancel_at_period_end = true), (sub.current_period_end = new Date(now + 3 * DAY).toISOString()), (type = "subscription.canceled");
  if (scenario === "subscription_ended") (sub.status = "canceled"), (sub.ended_at = new Date().toISOString()), (type = "subscription.revoked");
  return conn.transaction(async (tx) => {
    if (scenario === "expire_grace") {
      await tx.update(organizations).set({ graceEndsAt: new Date(now - 1000), trialEndsAt: org.billingStatus === "trialing" ? new Date(now - 1000) : org.trialEndsAt }).where(eq(organizations.id, organizationId));
      await logBillingEvent(tx, { organizationId, source: "dev", type: "dev.expire_grace", actorId, summary: "Simulated: grace / trial period ran out" });
      return;
    }
    const summary = await applySubscription(tx, organizationId, sub, type, plan);
    await logBillingEvent(tx, { organizationId, source: "dev", type: `dev.${scenario}`, actorId, summary: `Simulated: ${summary}` });
  });
}

/* -------------------------------- support access -------------------------------- */

/** A company admin lets the SyncSprint team look in (read-only) for a limited time. */
export async function setSupportAccess(conn: DB, actorId: string, organizationId: string, hours: number) {
  const h = z.number().int().min(0).max(72).parse(hours);
  await requireOrgPermission(actorId, organizationId, "admin", conn, BILLING);
  const until = h ? new Date(Date.now() + h * 3_600_000) : null;
  await conn.update(organizations).set({ supportAccessUntil: until }).where(eq(organizations.id, organizationId));
  await conn.insert(auditLogs).values({
    organizationId, actorId, action: h ? "SUPPORT_ACCESS_GRANTED" : "SUPPORT_ACCESS_REVOKED", entityType: "organization", entityId: organizationId, metadata: { hours: h },
  });
  return { until };
}

/** Admin emails per company (for the platform console and receipts). */
export async function adminEmails(conn: DbOrTx, organizationIds: string[]) {
  if (!organizationIds.length) return new Map<string, string[]>();
  const rows = await conn
    .select({ organizationId: orgMembers.organizationId, email: users.email })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(inArray(orgMembers.organizationId, organizationIds), inArray(orgMembers.role, ["admin", "owner"])));
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.organizationId, [...(m.get(r.organizationId) ?? []), r.email]);
  return m;
}
