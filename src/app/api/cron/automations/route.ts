import { timingSafeEqual } from "node:crypto";
import { runScheduler } from "@/server/scheduler-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Runs scheduled automations. Called by Vercel Cron (it sends `Authorization: Bearer $CRON_SECRET`)
 * or any external pinger with the same header. Without CRON_SECRET set, the endpoint stays closed.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("cron not configured", { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return new Response("unauthorized", { status: 401 });
  const r = await runScheduler();
  return Response.json(r);
}
