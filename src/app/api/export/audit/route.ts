import { db } from "@/db";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { exportAuditCsv } from "@/server/services/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/export/audit?org=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD — admins only, CSV download. */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Sign in first", { status: 401 });
  const url = new URL(req.url);
  const org = url.searchParams.get("org") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(org)) return new Response("Not found", { status: 404 });
  try {
    const csv = await exportAuditCsv(db, session.user.id, org, { from: url.searchParams.get("from"), to: url.searchParams.get("to") });
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.code.startsWith("FORBIDDEN") || err.code === "IP_NOT_ALLOWED" || err.code === "TWO_FACTOR_REQUIRED" ? 403 : 400 });
    if (err instanceof Error && err.name === "ZodError") return new Response("Dates must look like 2026-11-27", { status: 400 });
    throw err;
  }
}
