import { randomBytes } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { billingEvents, orgInvites, orgMembers, organizations, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { PLANS, TRIAL_DAYS, billingState, isBillableRole } from "@/lib/billing-rules";
import { isPlatformAdmin } from "@/lib/platform";
import { adminEmails, logBillingEvent, pickBilling } from "./billing";
import * as polar from "./polar";

/**
 * The platform owner's console (you, the vendor). Sees every company's plan and
 * payment status and can act on billing. Never sees customer work from here.
 * Every action is written to the billing log with who did it.
 */

const DAY = 86_400_000;

export async function requirePlatformAdmin(conn: DB, userId: string) {
  const [u] = await conn.select({ id: users.id, email: users.email, emailVerified: users.emailVerified }).from(users).where(eq(users.id, userId)).limit(1);
  // Indistinguishable from a missing page for everyone else.
  if (!isPlatformAdmin(u)) throw new AppError("NOT_FOUND");
  return u!;
}

export async function listCompanies(conn: DB, actorId: string, opts: { includeDemo?: boolean } = {}) {
  await requirePlatformAdmin(conn, actorId);
  const orgs = await conn
    .select()
    .from(organizations)
    .where(opts.includeDemo ? sql`true` : eq(organizations.isDemo, false))
    .orderBy(desc(organizations.createdAt))
    .limit(500);
  const ids = orgs.map((o) => o.id);
  const counts = ids.length
    ? await conn
        .select({ organizationId: orgMembers.organizationId, role: orgMembers.role, n: sql<number>`count(*)::int` })
        .from(orgMembers)
        .groupBy(orgMembers.organizationId, orgMembers.role)
    : [];
  const admins = await adminEmails(conn, ids);
  return orgs.map((o) => {
    const mine = counts.filter((c) => c.organizationId === o.id);
    const state = billingState(o);
    const billable = mine.filter((c) => isBillableRole(c.role)).reduce((s, c) => s + c.n, 0);
    const viewers = mine.filter((c) => c.role === "viewer").reduce((s, c) => s + c.n, 0);
    const monthly = ["payg", "team", "business"].includes(o.plan) && o.billingStatus !== "canceled" ? Math.max(PLANS[o.plan].minSeats, o.seatsPurchased ?? billable) * PLANS[o.plan].pricePerSeat : 0;
    return {
      id: o.id, name: o.name, slug: o.slug, isDemo: o.isDemo, createdAt: o.createdAt,
      ...pickBilling(o), state, billable, viewers, admins: admins.get(o.id) ?? [], monthlyRevenue: Math.round(monthly * 100) / 100,
    };
  });
}

export async function companyEvents(conn: DB, actorId: string, organizationId: string) {
  await requirePlatformAdmin(conn, actorId);
  return conn
    .select({ id: billingEvents.id, type: billingEvents.type, source: billingEvents.source, summary: billingEvents.summary, createdAt: billingEvents.createdAt, actorName: users.name })
    .from(billingEvents)
    .leftJoin(users, eq(users.id, billingEvents.actorId))
    .where(eq(billingEvents.organizationId, organizationId))
    .orderBy(desc(billingEvents.createdAt))
    .limit(50);
}

const ACTIONS = ["suspend", "reactivate", "extend_trial", "extend_grace", "comp", "end_comp", "cancel_at_period_end", "cancel_now"] as const;
export type PlatformAction = (typeof ACTIONS)[number];

export async function platformAction(conn: DB, actorId: string, organizationId: string, raw: { action: PlatformAction; days?: number; reason?: string }) {
  const input = z
    .object({ action: z.enum(ACTIONS), days: z.number().int().min(1).max(365).optional(), reason: z.string().trim().max(200).optional() })
    .parse(raw);
  await requirePlatformAdmin(conn, actorId);
  const [org] = await conn.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new AppError("NOT_FOUND", "Company not found");
  const now = new Date();
  const days = input.days ?? 7;
  let summary: string;
  let patch: Partial<typeof organizations.$inferInsert> = {};

  switch (input.action) {
    case "suspend":
      if (!input.reason) throw new AppError("VALIDATION", "Give a reason (the company admin sees it)");
      patch = { billingStatus: "suspended", suspendedAt: now, suspendedReason: input.reason };
      summary = `Suspended: ${input.reason}`;
      break;
    case "reactivate": {
      const status = org.polarSubscriptionId ? (org.graceEndsAt && org.graceEndsAt > now ? "past_due" : "active") : org.plan === "trial" ? "trialing" : "active";
      patch = { billingStatus: status, suspendedAt: null, suspendedReason: null, ...(status === "trialing" && (!org.trialEndsAt || org.trialEndsAt < now) ? { trialEndsAt: new Date(now.getTime() + 7 * DAY) } : {}) };
      summary = `Reactivated (${status})`;
      break;
    }
    case "extend_trial": {
      if (org.polarSubscriptionId && org.billingStatus === "active") throw new AppError("VALIDATION", "This company already pays");
      const from = org.trialEndsAt && org.trialEndsAt > now ? org.trialEndsAt : now;
      patch = { plan: "trial", billingStatus: "trialing", trialEndsAt: new Date(from.getTime() + days * DAY) };
      summary = `Trial extended by ${days} days`;
      break;
    }
    case "extend_grace": {
      if (org.billingStatus !== "past_due") throw new AppError("VALIDATION", "Grace only applies to an overdue payment");
      const from = org.graceEndsAt && org.graceEndsAt > now ? org.graceEndsAt : now;
      patch = { graceEndsAt: new Date(from.getTime() + days * DAY) };
      summary = `Grace extended by ${days} days`;
      break;
    }
    case "comp":
      patch = { plan: "comped", billingStatus: "active", suspendedAt: null, suspendedReason: null };
      summary = "Plan set to Complimentary (free)";
      break;
    case "end_comp":
      if (org.plan !== "comped") throw new AppError("VALIDATION", "This company isn't on a complimentary plan");
      patch = { plan: "trial", billingStatus: "trialing", trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY) };
      summary = `Complimentary plan ended; ${TRIAL_DAYS}-day trial to choose a plan`;
      break;
    case "cancel_at_period_end":
    case "cancel_now": {
      if (!org.polarSubscriptionId) throw new AppError("VALIDATION", "This company has no subscription");
      const immediately = input.action === "cancel_now";
      if (polar.polarConfig().enabled && !org.polarSubscriptionId.startsWith("sim_")) {
        await polar.cancelSubscription(org.polarSubscriptionId, immediately);
      }
      patch = immediately ? { billingStatus: "canceled", currentPeriodEnd: now, cancelAtPeriodEnd: false } : { cancelAtPeriodEnd: true };
      summary = immediately ? "Subscription canceled immediately" : "Subscription set to cancel at period end";
      break;
    }
  }
  await conn.update(organizations).set(patch).where(eq(organizations.id, organizationId));
  await logBillingEvent(conn, { organizationId, source: "platform", type: `platform.${input.action}`, actorId, summary });
  return { summary };
}

/**
 * Provision a company for a customer: an empty workspace on a trial, plus an admin
 * invite for the person you're handing it to. You are NOT added as a member.
 */
export async function provisionCompany(conn: DB, actorId: string, raw: { name: string; adminEmail: string; trialDays?: number }) {
  const input = z
    .object({ name: z.string().trim().min(2).max(120), adminEmail: z.string().trim().toLowerCase().email(), trialDays: z.number().int().min(1).max(90).default(TRIAL_DAYS) })
    .parse(raw);
  await requirePlatformAdmin(conn, actorId);
  const base = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "company";
  return conn.transaction(async (tx) => {
    let slug = base;
    for (let i = 0; i < 5; i++) {
      const [taken] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
      if (!taken) break;
      slug = `${base}-${randomBytes(2).toString("hex")}`;
    }
    const [org] = await tx
      .insert(organizations)
      .values({ name: input.name, slug, trialEndsAt: new Date(Date.now() + input.trialDays * DAY) })
      .returning();
    const token = randomBytes(32).toString("base64url");
    await tx.insert(orgInvites).values({
      organizationId: org!.id, email: input.adminEmail, role: "admin", token, invitedById: actorId, expiresAt: new Date(Date.now() + 14 * DAY),
    });
    await logBillingEvent(tx, { organizationId: org!.id, source: "platform", type: "platform.provision", actorId, summary: `Created for ${input.adminEmail} with a ${input.trialDays}-day trial` });
    return { organizationId: org!.id, slug, token };
  });
}

/** Summary numbers for the console header. */
export function platformTotals(rows: Awaited<ReturnType<typeof listCompanies>>) {
  const real = rows.filter((r) => !r.isDemo);
  return {
    companies: real.length,
    paying: real.filter((r) => r.monthlyRevenue > 0 && r.state.access === "full").length,
    trials: real.filter((r) => r.state.phase === "trial").length,
    atRisk: real.filter((r) => ["grace", "read_only", "ending"].includes(r.state.phase)).length,
    locked: real.filter((r) => r.state.access === "locked").length,
    mrr: Math.round(real.filter((r) => r.state.access !== "locked").reduce((s, r) => s + r.monthlyRevenue, 0) * 100) / 100,
  };
}

