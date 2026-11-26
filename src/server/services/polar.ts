import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlanId } from "@/lib/billing-rules";

/**
 * Minimal Polar (polar.sh) client over fetch, pinned to API version 2026-10.
 * Polar is the merchant of record: it charges cards, handles sales tax/VAT and invoices,
 * and pays out (including to Pakistan, via Stripe Connect Express).
 *
 * Env:
 *   POLAR_ACCESS_TOKEN       Organization Access Token (polar_oat_...), one per environment
 *   POLAR_SERVER             "sandbox" (default) or "production"
 *   POLAR_WEBHOOK_SECRET     endpoint secret (whsec_...)
 *   POLAR_PRODUCT_PAYG / POLAR_PRODUCT_TEAM / POLAR_PRODUCT_BUSINESS   product ids (seat-based prices)
 */

export const POLAR_API_VERSION = "2026-10";

export function polarConfig() {
  const token = process.env.POLAR_ACCESS_TOKEN;
  const products: Partial<Record<PlanId, string>> = {
    payg: process.env.POLAR_PRODUCT_PAYG,
    team: process.env.POLAR_PRODUCT_TEAM,
    business: process.env.POLAR_PRODUCT_BUSINESS,
  };
  return {
    enabled: !!token && !!products.payg && !!products.team && !!products.business,
    token,
    baseUrl: process.env.POLAR_SERVER === "production" ? "https://api.polar.sh" : "https://sandbox-api.polar.sh",
    sandbox: process.env.POLAR_SERVER !== "production",
    products,
    webhookSecret: process.env.POLAR_WEBHOOK_SECRET,
  };
}

export function planForProduct(productId: string | null | undefined): PlanId | null {
  const { products } = polarConfig();
  for (const [plan, id] of Object.entries(products)) if (id && id === productId) return plan as PlanId;
  return null;
}

export class PolarError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const cfg = polarConfig();
  if (!cfg.token) throw new PolarError(0, "Payments aren't connected yet");
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Polar-Version": POLAR_API_VERSION,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { detail?: unknown; error?: string };
      detail = typeof j.detail === "string" ? j.detail : j.error ?? detail;
    } catch {}
    throw new PolarError(res.status, `Payment provider error (${res.status}): ${detail}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Hosted checkout for a seat-based product. Returns the URL to send the admin to. */
export function createCheckout(input: {
  productId: string;
  seats: number;
  minSeats: number;
  maxSeats: number | null;
  organizationId: string;
  email: string;
  successUrl: string;
}) {
  return call<{ id: string; url: string }>("POST", "/v1/checkouts/", {
    products: [input.productId],
    seats: input.seats,
    min_seats: input.minSeats,
    ...(input.maxSeats ? { max_seats: input.maxSeats } : {}),
    external_customer_id: input.organizationId,
    customer_email: input.email,
    metadata: { organizationId: input.organizationId },
    success_url: input.successUrl,
  });
}

/** Customer portal (update card, invoices, cancel) for a company. */
export function createPortalSession(organizationId: string, returnUrl: string) {
  return call<{ customer_portal_url: string }>("POST", "/v1/customer-sessions/", { external_customer_id: organizationId, return_url: returnUrl });
}

export function updateSeats(subscriptionId: string, seats: number) {
  return call<PolarSubscription>("PATCH", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { seats, proration_behavior: "prorate" });
}

/** Platform owner: cancel at period end (default) or revoke immediately. */
export function cancelSubscription(subscriptionId: string, immediately: boolean) {
  return immediately
    ? call<PolarSubscription>("DELETE", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`)
    : call<PolarSubscription>("PATCH", `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: true });
}

export type PolarSubscription = {
  id: string;
  status: "incomplete" | "incomplete_expired" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "paused" | "trial_ended";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  ended_at: string | null;
  product_id: string;
  customer_id: string;
  seats: number | null;
  metadata?: Record<string, unknown>;
  customer?: { id: string; external_id: string | null; email?: string };
};

/* ------------------------------ webhook signatures ------------------------------ */

/**
 * Standard Webhooks verification (what Polar uses):
 *   signed content = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 *   webhook-signature = space-separated "v1,<base64 HMAC-SHA256>" entries
 * Keys tried (like Polar's SDK): the base64-decoded part after "whsec_" (Standard
 * Webhooks endpoints) and the UTF-8 bytes of the whole secret (older endpoints).
 * Timestamps more than 5 minutes off are rejected (replay protection).
 */
export function verifyPolarWebhook(rawBody: string, headers: Headers, secret: string, now = Date.now()): boolean {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !ts || !sigHeader || !/^\d+$/.test(ts)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const content = `${id}.${ts}.${rawBody}`;
  const keys: Buffer[] = [Buffer.from(secret, "utf8")];
  const b64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  try {
    const decoded = Buffer.from(b64, "base64");
    if (decoded.length) keys.unshift(decoded);
  } catch {}
  const given = sigHeader
    .split(" ")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1,"))
    .map((s) => Buffer.from(s.slice(3)));
  for (const key of keys) {
    const expected = Buffer.from(createHmac("sha256", key).update(content).digest("base64"));
    if (given.some((g) => g.length === expected.length && timingSafeEqual(g, expected))) return true;
  }
  return false;
}

/** Test helper / docs: produce a valid signature header. */
export function signPolarWebhook(rawBody: string, id: string, ts: number, secret: string) {
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64")}`;
}
