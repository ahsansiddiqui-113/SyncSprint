import { db } from "@/db";
import { AppError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { INLINE_TYPES, readAttachment } from "@/server/services/attachments";

export const runtime = "nodejs";

/**
 * Download an attachment. Membership is checked on every request. Only raster
 * images render inline; everything else (HTML, SVG, PDF...) is forced to download,
 * and `nosniff` plus a locked-down sandbox CSP stop the browser from executing anything.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    const row = await readAttachment(db, session.user.id, id);
    const inline = INLINE_TYPES.has(row.contentType) && new URL(req.url).searchParams.get("download") !== "1";
    const encoded = encodeURIComponent(row.filename);
    const ascii = row.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const disposition = `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
    return new Response(new Uint8Array(row.data), {
      headers: {
        "Content-Type": inline ? row.contentType : "application/octet-stream",
        "Content-Length": String(row.size),
        "Content-Disposition": disposition,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response("Not found", { status: 404 });
    console.error("[attachments] download failed", err);
    return new Response("Error", { status: 500 });
  }
}
