import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, boardColumns, devLinks, orgMembers, organizations, projects, repoConnections, tasks, type Task } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { seal, unseal } from "@/lib/seal";
import { billingState } from "@/lib/billing-rules";
import { moveTask } from "./tasks";
import { notify } from "./notifications";
import { newEffects, type Effects } from "./task-effects";

/**
 * GitHub / GitLab development links (Azure Boards "Development", Jira dev panel):
 *  - a repository sends webhooks to /api/integrations/<provider>/<connectionId>, signed with a secret
 *  - commits, branches and pull/merge requests that mention ENG-12 appear on that task
 *  - a merged PR saying "fixes ENG-12" (or closes / resolves) moves the task to the last status
 * Secrets are sealed at rest; deliveries are verified (HMAC for GitHub, token for GitLab).
 */

const REF = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g;
const CLOSE = /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\b\s*:?\s*((?:[A-Z][A-Z0-9]{1,9}-\d{1,7}(?:\s*(?:,|and)\s*)?)+)/gi;

export function findRefs(text: string) {
  return [...new Set([...text.toUpperCase().matchAll(REF)].map((m) => `${m[1]}-${m[2]}`))];
}
export function findClosing(text: string) {
  const out = new Set<string>();
  for (const m of text.matchAll(CLOSE)) for (const r of findRefs(m[1]!)) out.add(r);
  return [...out];
}

/* -------------------------------- connections -------------------------------- */

export async function listConnections(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const rows = await conn.select().from(repoConnections).where(eq(repoConnections.organizationId, organizationId)).orderBy(desc(repoConnections.createdAt));
  return rows.map(({ secretSealed: _s, ...r }) => (void _s, r));
}

export async function createConnection(conn: DB, actorId: string, organizationId: string, raw: { provider: "github" | "gitlab"; name: string; autoClose: boolean }) {
  const v = z.object({ provider: z.enum(["github", "gitlab"]), name: z.string().trim().min(1, "Name it after the repository").max(120), autoClose: z.boolean() }).parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [{ n }] = (await conn.select({ n: sql<number>`count(*)::int` }).from(repoConnections).where(eq(repoConnections.organizationId, organizationId))) as [{ n: number }];
  if (n >= 50) throw new AppError("VALIDATION", "Up to 50 repositories");
  const secret = randomBytes(24).toString("base64url");
  const [c] = await conn.insert(repoConnections).values({ organizationId, provider: v.provider, name: v.name, autoClose: v.autoClose, secretSealed: seal(secret), createdById: actorId }).returning({ id: repoConnections.id });
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "REPO_CONNECTED", entityType: "organization", entityId: organizationId, metadata: { provider: v.provider, name: v.name } });
  return { id: c!.id, secret };
}

export async function updateConnection(conn: DB, actorId: string, organizationId: string, id: string, raw: { autoClose: boolean; enabled: boolean }) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const v = z.object({ autoClose: z.boolean(), enabled: z.boolean() }).parse(raw);
  const [c] = await conn.update(repoConnections).set(v).where(and(eq(repoConnections.id, id), eq(repoConnections.organizationId, organizationId))).returning({ id: repoConnections.id });
  if (!c) throw new AppError("NOT_FOUND", "Repository not found");
}

export async function rotateConnectionSecret(conn: DB, actorId: string, organizationId: string, id: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const secret = randomBytes(24).toString("base64url");
  const [c] = await conn.update(repoConnections).set({ secretSealed: seal(secret) }).where(and(eq(repoConnections.id, id), eq(repoConnections.organizationId, organizationId))).returning({ id: repoConnections.id });
  if (!c) throw new AppError("NOT_FOUND", "Repository not found");
  return secret;
}

export async function deleteConnection(conn: DB, actorId: string, organizationId: string, id: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const gone = await conn.delete(repoConnections).where(and(eq(repoConnections.id, id), eq(repoConnections.organizationId, organizationId))).returning({ id: repoConnections.id });
  if (!gone.length) throw new AppError("NOT_FOUND", "Repository not found");
}

export async function listDevLinks(conn: DB, actorId: string, organizationId: string, taskId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn
    .select({ id: devLinks.id, provider: devLinks.provider, kind: devLinks.kind, url: devLinks.url, title: devLinks.title, state: devLinks.state, author: devLinks.author, repo: devLinks.repo, updatedAt: devLinks.updatedAt })
    .from(devLinks)
    .where(and(eq(devLinks.organizationId, organizationId), eq(devLinks.taskId, taskId)))
    .orderBy(desc(devLinks.updatedAt));
}

/* ------------------------------ webhook handling ------------------------------ */

export class DevHookError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Item = { kind: "commit" | "pull_request" | "branch"; externalId: string; url: string; title: string; text: string; state: "open" | "merged" | "closed" | "pushed"; author: string | null; repo: string; merged: boolean };

/** Parse a GitHub delivery into link items. */
export function parseGithub(event: string, body: Record<string, any>): Item[] {
  const repo: string = body.repository?.full_name ?? "repo";
  if (event === "push") {
    const branch = String(body.ref ?? "").replace(/^refs\/heads\//, "");
    const items: Item[] = (body.commits ?? []).slice(0, 50).map((c: any) => ({
      kind: "commit", externalId: `${repo}@${c.id}`, url: c.url, title: String(c.message ?? "").split("\n")[0]!.slice(0, 300),
      text: `${c.message ?? ""}`, state: "pushed", author: c.author?.username ?? c.author?.name ?? null, repo, merged: false,
    }));
    if (branch && findRefs(branch).length && body.created) items.push({ kind: "branch", externalId: `${repo}:branch:${branch}`, url: `${body.repository?.html_url}/tree/${branch}`, title: branch, text: branch, state: "open", author: body.sender?.login ?? null, repo, merged: false });
    return items;
  }
  if (event === "pull_request" && body.pull_request) {
    const pr = body.pull_request;
    const state = pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open";
    return [{ kind: "pull_request", externalId: `${repo}#${pr.number}`, url: pr.html_url, title: `#${pr.number} ${pr.title}`.slice(0, 300), text: `${pr.title}\n${pr.body ?? ""}\n${pr.head?.ref ?? ""}`, state, author: pr.user?.login ?? null, repo, merged: !!pr.merged }];
  }
  if (event === "create" && body.ref_type === "branch") {
    return [{ kind: "branch", externalId: `${repo}:branch:${body.ref}`, url: `${body.repository?.html_url}/tree/${body.ref}`, title: String(body.ref), text: String(body.ref), state: "open", author: body.sender?.login ?? null, repo, merged: false }];
  }
  return [];
}

/** Parse a GitLab delivery into link items. */
export function parseGitlab(body: Record<string, any>): Item[] {
  const repo: string = body.project?.path_with_namespace ?? "repo";
  if (body.object_kind === "push") {
    return (body.commits ?? []).slice(0, 50).map((c: any) => ({
      kind: "commit", externalId: `${repo}@${c.id}`, url: c.url, title: String(c.title ?? c.message ?? "").split("\n")[0]!.slice(0, 300),
      text: `${c.message ?? ""}`, state: "pushed", author: c.author?.name ?? null, repo, merged: false,
    }));
  }
  if (body.object_kind === "merge_request" && body.object_attributes) {
    const mr = body.object_attributes;
    const state = mr.state === "merged" ? "merged" : mr.state === "closed" ? "closed" : "open";
    return [{ kind: "pull_request", externalId: `${repo}!${mr.iid}`, url: mr.url, title: `!${mr.iid} ${mr.title}`.slice(0, 300), text: `${mr.title}\n${mr.description ?? ""}\n${mr.source_branch ?? ""}`, state, author: body.user?.username ?? null, repo, merged: state === "merged" }];
  }
  return [];
}

export async function verifyAndLoad(conn: DB, provider: "github" | "gitlab", connectionId: string, headers: Headers, rawBody: string) {
  if (!z.string().uuid().safeParse(connectionId).success) throw new DevHookError(404, "Unknown connection");
  const [c] = await conn.select().from(repoConnections).where(and(eq(repoConnections.id, connectionId), eq(repoConnections.provider, provider))).limit(1);
  if (!c) throw new DevHookError(404, "Unknown connection");
  const secret = unseal(c.secretSealed);
  if (provider === "github") {
    const sig = headers.get("x-hub-signature-256") ?? "";
    const want = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw new DevHookError(401, "Bad signature");
  } else {
    const token = headers.get("x-gitlab-token") ?? "";
    if (token.length !== secret.length || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) throw new DevHookError(401, "Bad token");
  }
  return c;
}

/**
 * Link items to tasks of this workspace; close tasks for merged "fixes" PRs.
 * Returns what changed so callers can publish live updates.
 */
export async function applyDevItems(conn: DB, connection: typeof repoConnections.$inferSelect, items: Item[], fx: Effects = newEffects()) {
  const organizationId = connection.organizationId;
  const result = { linked: [] as { taskId: string; projectId: string }[], closed: [] as Task[] };
  if (!connection.enabled || !items.length) return result;
  const [org] = await conn.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org || billingState(org).access !== "full") return result; // integrations pause while read-only / locked
  await conn.update(repoConnections).set({ lastEventAt: new Date() }).where(eq(repoConnections.id, connection.id));

  const refs = [...new Set(items.flatMap((i) => findRefs(i.text)))];
  if (!refs.length) return result;
  const keys = [...new Set(refs.map((r) => r.split("-")[0]!))];
  const projs = await conn.select({ id: projects.id, key: projects.key }).from(projects).where(and(eq(projects.organizationId, organizationId), inArray(projects.key, keys)));
  const found = new Map<string, Task>();
  for (const p of projs) {
    const nums = refs.filter((r) => r.startsWith(`${p.key}-`)).map((r) => Number(r.split("-")[1]));
    if (!nums.length) continue;
    const rows = await conn.select().from(tasks).where(and(eq(tasks.projectId, p.id), inArray(tasks.taskNumber, nums)));
    for (const t of rows) found.set(`${p.key}-${t.taskNumber}`, t);
  }

  // Act as the connection's creator when closing tasks (if still a member).
  const actorOk = connection.createdById
    ? (await conn.select({ id: orgMembers.id }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, connection.createdById))).limit(1)).length > 0
    : false;

  for (const item of items) {
    const closing = new Set(item.merged ? findClosing(item.text) : []);
    for (const ref of findRefs(item.text)) {
      const task = found.get(ref);
      if (!task) continue;
      await conn
        .insert(devLinks)
        .values({ organizationId, taskId: task.id, connectionId: connection.id, provider: connection.provider, kind: item.kind, externalId: item.externalId.slice(0, 300), url: item.url, title: item.title, state: item.state, author: item.author, repo: item.repo })
        .onConflictDoUpdate({ target: [devLinks.taskId, devLinks.externalId], set: { title: item.title, state: item.state, url: item.url, updatedAt: new Date() } });
      result.linked.push({ taskId: task.id, projectId: task.projectId });

      if (connection.autoClose && closing.has(ref) && actorOk) {
        const [last] = await conn.select({ id: boardColumns.id }).from(boardColumns).where(eq(boardColumns.projectId, task.projectId)).orderBy(desc(boardColumns.position)).limit(1);
        const [current] = await conn.select().from(tasks).where(eq(tasks.id, task.id)).limit(1);
        if (last && current && current.columnId !== last.id) {
          const [top] = await conn.select({ p: tasks.position }).from(tasks).where(eq(tasks.columnId, last.id)).orderBy(asc(tasks.position)).limit(1);
          const moved = await moveTask(conn, connection.createdById!, { organizationId, taskId: current.id, targetColumnId: last.id, newPosition: (top?.p ?? 2048) / 2, expectedVersion: current.version }, fx);
          if (moved.ok) {
            result.closed.push(moved.task);
            if (current.assigneeId) {
              await notify(conn, organizationId, null, [{ userId: current.assigneeId, kind: "dev", taskId: current.id, title: `${ref} closed by merged ${item.title}`.slice(0, 200), body: item.repo, link: null }]);
            }
          }
        }
      }
    }
  }
  return result;
}
