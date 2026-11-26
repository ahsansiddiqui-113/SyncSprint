import { db } from "@/db";
import { handlePolarWebhook } from "@/server/services/billing";

export const runtime = "nodejs";

/**
 * Polar webhook endpoint. Add it in Polar → Settings → Webhooks as
 * https://<your-domain>/api/billing/polar with the subscription.* and order.paid events.
 * The raw body is required for signature verification.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 512_000) return new Response("too large", { status: 413 });
  try {
    const r = await handlePolarWebhook(db, raw, req.headers);
    return new Response(r.body, { status: r.status });
  } catch (err) {
    console.error("[billing] webhook failed", err);
    return new Response("error", { status: 500 }); // Polar retries
  }
}
