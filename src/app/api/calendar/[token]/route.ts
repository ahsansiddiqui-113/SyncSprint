import { db } from "@/db";
import { calendarIcs } from "@/server/services/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/calendar/<token>.ics — private feed for Google / Outlook / Apple Calendar. The token is the secret. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const ics = await calendarIcs(db, token.replace(/\.ics$/, ""));
  if (!ics) return new Response("Not found", { status: 404 });
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="syncsprint.ics"',
      "cache-control": "private, max-age=300",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    },
  });
}
