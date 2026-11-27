import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { AppError } from "@/lib/errors";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { publishTask } from "@/server/public-events";
import { handleInbound, normalizeInbound } from "@/server/services/inbound-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound email webhook (Postmark / Resend / SendGrid / Mailgun). Protected by INBOUND_EMAIL_SECRET,
 * sent as `Authorization: Bearer <secret>`, HTTP basic auth password, or `?secret=` (providers differ).
 * Always answers 200 for well-formed but rejected mail, so providers don't retry spam forever.
 */
export async function POST(req: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return new Response("inbound email not configured", { status: 503 });
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? "";
  const basic = auth.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString().split(":").slice(1).join(":") : null;
  const given = auth.startsWith("Bearer ") ? auth.slice(7) : basic ?? url.searchParams.get("secret") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("unauthorized", { status: 401 });

  let body: Record<string, unknown> = {};
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) body = (await req.json()) as Record<string, unknown>;
    else body = Object.fromEntries((await req.formData()).entries()) as Record<string, unknown>;
  } catch {
    return new Response("bad payload", { status: 400 });
  }
  const mail = normalizeInbound(body);
  if (!mail) return Response.json({ accepted: false, reason: "missing from/to" });
  try {
    const r = await handleInbound(db, mail);
    const actor = { id: "email", name: "Email" };
    broadcastOrgEvent(r.organizationId, { type: "TASK_CREATED", actor, task: toTaskDTO(r.task) });
    publishTask(r.organizationId, "task.created", r.task);
    return Response.json({ accepted: true, ref: r.ref });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ accepted: false, reason: err.message });
    throw err;
  }
}
