/**
 * Plans and the billing lifecycle, as pure functions (shared by server and UI).
 *
 *   trial (14 days) ─► active ─► payment fails ─► past due: 7-day grace (full access, banner)
 *        │                                         ─► read-only for 14 days (view + export only)
 *        └─ trial ends unpaid ─► read-only ────────►─► locked (admins see only Billing)
 *   canceled ─► access until the paid period ends ─► read-only ─► locked
 *   suspended by the platform owner ─► locked immediately
 *   Data is kept for 90 days after a workspace locks, then may be deleted (manual, by the platform owner).
 */

export type PlanId = "trial" | "payg" | "team" | "business" | "comped";
export type BillingStatusId = "trialing" | "active" | "past_due" | "canceled" | "suspended";
export type Access = "full" | "read_only" | "locked";

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;
export const READ_ONLY_DAYS = 14;
export const RETENTION_DAYS = 90;
export const SEAT_GRACE_DAYS = 7;

export type PlanInfo = {
  id: PlanId;
  name: string;
  /** USD per billable person per month. */
  pricePerSeat: number;
  interval: "month" | "year" | null;
  minSeats: number;
  /** Most billable people the plan covers (null = no limit). */
  maxSeats: number | null;
  blurb: string;
  purchasable: boolean;
};

export const PLANS: Record<PlanId, PlanInfo> = {
  trial: { id: "trial", name: "Free trial", pricePerSeat: 0, interval: null, minSeats: 1, maxSeats: 100, blurb: "Everything, free for 14 days.", purchasable: false },
  payg: { id: "payg", name: "Pay as you go", pricePerSeat: 5, interval: "month", minSeats: 2, maxSeats: null, blurb: "Billed monthly for the people you actually have. Cancel anytime.", purchasable: true },
  team: { id: "team", name: "Team", pricePerSeat: 3.5, interval: "year", minSeats: 5, maxSeats: 50, blurb: "For companies of 1 to 50 people, billed yearly.", purchasable: true },
  business: { id: "business", name: "Business", pricePerSeat: 3, interval: "year", minSeats: 51, maxSeats: 100, blurb: "For companies of 51 to 100 people, billed yearly.", purchasable: true },
  comped: { id: "comped", name: "Complimentary", pricePerSeat: 0, interval: null, minSeats: 1, maxSeats: null, blurb: "Provided free by SyncSprint.", purchasable: false },
};

/** Which plan fits a company of this size (above 100: contact sales). */
export function suggestPlan(people: number): PlanId | null {
  if (people > 100) return null;
  return people > 50 ? "business" : "team";
}

/** Price for a period: seats are never below the plan minimum. */
export function quote(plan: PlanId, people: number) {
  const p = PLANS[plan];
  const seats = Math.max(p.minSeats, people);
  const monthly = Math.round(seats * p.pricePerSeat * 100) / 100;
  return { seats, monthly, perPeriod: p.interval === "year" ? Math.round(monthly * 12 * 100) / 100 : monthly };
}

export type BillingFields = {
  isDemo: boolean;
  plan: PlanId;
  billingStatus: BillingStatusId;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  graceEndsAt: Date | null;
  suspendedAt: Date | null;
  createdAt: Date;
};

export type Phase = "demo" | "comped" | "trial" | "active" | "ending" | "grace" | "read_only" | "locked" | "suspended";

export type BillingState = {
  access: Access;
  phase: Phase;
  /** Short message for banners (null when nothing to say). */
  message: string | null;
  /** Next moment the access level changes, if any. */
  changesAt: Date | null;
  /** When data may be deleted (locked workspaces only). */
  deleteAfter: Date | null;
};

const DAY = 86_400_000;
const add = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
const daysLeft = (to: Date, now: Date) => Math.max(0, Math.ceil((to.getTime() - now.getTime()) / DAY));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** After an end date: read-only for READ_ONLY_DAYS, then locked. */
function afterEnd(end: Date, now: Date, why: string): BillingState {
  const lockAt = add(end, READ_ONLY_DAYS);
  if (now < lockAt) {
    return { access: "read_only", phase: "read_only", message: `${why} The workspace is read-only; it locks in ${plural(daysLeft(lockAt, now), "day")}.`, changesAt: lockAt, deleteAfter: null };
  }
  return { access: "locked", phase: "locked", message: `${why} The workspace is locked until billing is resolved.`, changesAt: null, deleteAfter: add(lockAt, RETENTION_DAYS) };
}

export function billingState(o: BillingFields, now = new Date()): BillingState {
  if (o.isDemo) return { access: "full", phase: "demo", message: null, changesAt: null, deleteAfter: null };
  if (o.billingStatus === "suspended") {
    const since = o.suspendedAt ?? now;
    return { access: "locked", phase: "suspended", message: "This workspace has been suspended by SyncSprint. An admin can resolve it from Billing.", changesAt: null, deleteAfter: add(since, RETENTION_DAYS) };
  }
  if (o.plan === "comped" && o.billingStatus !== "canceled") return { access: "full", phase: "comped", message: null, changesAt: null, deleteAfter: null };

  switch (o.billingStatus) {
    case "trialing": {
      const end = o.trialEndsAt ?? add(o.createdAt, TRIAL_DAYS);
      if (now < end) {
        const d = daysLeft(end, now);
        return { access: "full", phase: "trial", message: d <= 3 ? `Your free trial ends in ${plural(d, "day")}. Choose a plan to keep going.` : null, changesAt: end, deleteAfter: null };
      }
      return afterEnd(end, now, "Your free trial has ended.");
    }
    case "active": {
      const end = o.currentPeriodEnd;
      if (o.cancelAtPeriodEnd && end) {
        if (now < end) return { access: "full", phase: "ending", message: `Your subscription is canceled and ends in ${plural(daysLeft(end, now), "day")}.`, changesAt: end, deleteAfter: null };
        return afterEnd(end, now, "Your subscription has ended.");
      }
      return { access: "full", phase: "active", message: null, changesAt: null, deleteAfter: null };
    }
    case "past_due": {
      const grace = o.graceEndsAt ?? add(now, GRACE_DAYS);
      if (now < grace) {
        return { access: "full", phase: "grace", message: `We couldn't take your last payment. Update your card within ${plural(daysLeft(grace, now), "day")} to avoid interruption.`, changesAt: grace, deleteAfter: null };
      }
      return afterEnd(grace, now, "Payment is overdue.");
    }
    case "canceled":
      return afterEnd(o.currentPeriodEnd ?? now, now, "Your subscription has ended.");
  }
}

/** Seats: admins and members are billable; viewers are free. */
export const isBillableRole = (role: string) => role === "admin" || role === "owner" || role === "member";

export type SeatCheck = { ok: true; overLimit: boolean } | { ok: false; reason: string };

/**
 * Adding one more billable person. Going over the plan limit is allowed for a
 * 7-day grace period (with a prompt to upgrade); after that, new billable people are blocked.
 */
export function checkSeat(plan: PlanId, billableNow: number, overageSince: Date | null, now = new Date()): SeatCheck {
  const max = PLANS[plan].maxSeats;
  if (max === null || billableNow + 1 <= max) return { ok: true, overLimit: false };
  if (overageSince && now.getTime() - overageSince.getTime() > SEAT_GRACE_DAYS * DAY) {
    const next = plan === "team" ? "Business" : "a larger plan (contact us)";
    return { ok: false, reason: `Your ${PLANS[plan].name} plan covers ${max} people and the 7-day grace has passed. Upgrade to ${next}, or make someone a viewer (viewers are free).` };
  }
  return { ok: true, overLimit: true };
}
