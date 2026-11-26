import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { boardColumns, orgMembers, projects, tasks, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { authenticateApiKey, takeRateLimit, type ApiPrincipal } from "@/server/services/api-keys";

/**
 * Shared plumbing for /api/v1: bearer-key auth, per-key rate limit, scope check,
 * consistent JSON errors. No CORS headers on purpose: keys belong on servers, not in browsers.
 */

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  FORBIDDEN_NOT_A_MEMBER: 403,
  FORBIDDEN_REQUIRES_VIEWER: 403,
  FORBIDDEN_REQUIRES_MEMBER: 403,
  FORBIDDEN_REQUIRES_ADMIN: 403,
  FORBIDDEN_REQUIRES_OWNER: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  QUOTA_EXCEEDED: 413,
  WORKSPACE_READ_ONLY: 402,
  WORKSPACE_LOCKED: 402,
  SEAT_LIMIT: 402,
};

export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status, headers });
}

export type ApiContext = ApiPrincipal & { actor: { id: string; name: string } };

export async function withApi(req: Request, opts: { write?: boolean }, handler: (ctx: ApiContext) => Promise<unknown | Response>) {
  const header = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  let principal: Awaited<ReturnType<typeof authenticateApiKey>>;
  try {
    principal = await authenticateApiKey(db, token);
  } catch (err) {
    // A failed lookup is a server problem, not a bad key: never report it as 401.
    console.error("[api] key lookup failed", err);
    return apiError(500, "INTERNAL", "Something went wrong.");
  }
  if (!principal) return apiError(401, "UNAUTHENTICATED", "Missing or invalid API key. Send `Authorization: Bearer ssk_...`.");
  const limit = takeRateLimit(principal.keyId);
  const rl = { "X-RateLimit-Limit": "120", "X-RateLimit-Remaining": String(limit.remaining) };
  if (!limit.ok) return apiError(429, "RATE_LIMITED", "Too many requests. Slow down and retry.", {}, { ...rl, "Retry-After": String(limit.retryAfter) });
  if (opts.write && principal.scope !== "write") return apiError(403, "FORBIDDEN", "This key is read-only.", {}, rl);
  try {
    const out = await handler({ ...principal, actor: { id: principal.userId, name: `${principal.userName} (API)` } });
    if (out instanceof Response) {
      for (const [k, v] of Object.entries(rl)) out.headers.set(k, v);
      return out;
    }
    return NextResponse.json(out, { headers: rl });
  } catch (err) {
    if (err instanceof AppError) return apiError(STATUS[err.code] ?? 400, err.code, err.message, {}, rl);
    if (err instanceof ZodError) {
      return apiError(400, "VALIDATION", "Invalid request body.", { issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, rl);
    }
    if (err instanceof SyntaxError) return apiError(400, "VALIDATION", "Body must be valid JSON.", {}, rl);
    console.error("[api] unhandled", err);
    return apiError(500, "INTERNAL", "Something went wrong.", {}, rl);
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 200_000) throw new AppError("VALIDATION", "Body too large");
  const body = await req.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError("VALIDATION", "Body must be a JSON object");
  return body as Record<string, unknown>;
}

export async function projectByKey(organizationId: string, key: string) {
  const [p] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), eq(projects.key, key.toUpperCase())))
    .limit(1);
  if (!p) throw new AppError("NOT_FOUND", `No project with key ${key}`);
  return p;
}

/** A task by id or reference ("ENG-12"), inside the key's workspace only. */
export async function taskByIdOrRef(organizationId: string, idOrRef: string) {
  const ref = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$/.exec(idOrRef);
  const [row] = ref
    ? await db
        .select({ task: tasks })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(and(eq(tasks.organizationId, organizationId), eq(projects.key, ref[1]!.toUpperCase()), eq(tasks.taskNumber, Number(ref[2]))))
        .limit(1)
    : /^[0-9a-f-]{36}$/i.test(idOrRef)
      ? await db.select({ task: tasks }).from(tasks).where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, idOrRef))).limit(1)
      : [];
  if (!row) throw new AppError("NOT_FOUND", "Task not found");
  return row.task;
}

/** A status by id or (case-insensitive) name within a project. */
export async function columnFor(projectId: string, status: string) {
  const cols = await db
    .select({ id: boardColumns.id, title: boardColumns.title })
    .from(boardColumns)
    .where(and(eq(boardColumns.projectId, projectId), /^[0-9a-f-]{36}$/i.test(status) ? eq(boardColumns.id, status) : ilike(boardColumns.title, status.replace(/[%_\\]/g, "\\$&"))))
    .orderBy(asc(boardColumns.position))
    .limit(1);
  if (!cols[0]) throw new AppError("VALIDATION", `Unknown status "${status}"`);
  return cols[0];
}

/** Assignee by id or email; must be a member of the workspace. `null` unassigns. */
export async function resolveAssignee(organizationId: string, value: unknown): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new AppError("VALIDATION", "assignee must be a user id or email");
  const [m] = await db
    .select({ id: users.id })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.organizationId, organizationId), or(/^[0-9a-f-]{36}$/i.test(value) ? eq(users.id, value) : undefined, ilike(users.email, value.replace(/[%_\\]/g, "\\$&")))))
    .limit(1);
  if (!m) throw new AppError("VALIDATION", "assignee isn't a member of this workspace");
  return m.id;
}
