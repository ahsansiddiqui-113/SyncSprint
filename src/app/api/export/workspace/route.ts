import { db } from "@/db";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { exportWorkspace } from "@/server/services/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/export/workspace?org=<id> — admins only. The whole workspace as one JSON file (no secrets, no file bytes). */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Sign in first", { status: 401 });
  const org = new URL(req.url).searchParams.get("org") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(org)) return new Response("Not found", { status: 404 });
  try {
    const data = await exportWorkspace(db, session.user.id, org);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${data.organization.slug}-export-${new Date().toISOString().slice(0, 10)}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: 403 });
    throw err;
  }
}
