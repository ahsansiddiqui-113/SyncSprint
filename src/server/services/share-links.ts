import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import {
  auditLogs,
  boardColumns,
  checklistItems,
  organizations,
  projects,
  shareLinks,
  tags,
  taskComments,
  taskTags,
  tasks,
  teams,
  users,
  type ShareLink,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { billingState } from "@/lib/billing-rules";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Read-only share links for people without an account (clients, stakeholders).
 *  - admins only; one project by default, the whole workspace only on purpose
 *  - optional expiry and password; revocable; view count recorded
 *  - only a SHA-256 of the token is stored (the URL is shown once)
 *  - shared pages never include emails, and stop working while a workspace is locked
 */

const DAY = 86_400_000;
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString("hex")}`;
}
function passwordMatches(pw: string, stored: string) {
  const [, salt, hex] = stored.split("$");
  if (!salt || !hex) return false;
  const a = scryptSync(pw, salt, 32);
  const b = Buffer.from(hex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

const linkInput = z
  .object({
    scope: z.enum(["project", "workspace"]),
    projectId: z.string().uuid().nullish(),
    label: z.string().trim().min(1, "Name the link, e.g. who it's for").max(80),
    expiresInDays: z.number().int().min(1).max(365).nullish(),
    password: z.string().min(6, "Passwords need at least 6 characters").max(100).nullish(),
    includeComments: z.boolean().default(false),
  })
  .refine((v) => v.scope === "workspace" || !!v.projectId, { message: "Pick a project to share" });

export async function createShareLink(conn: DB, actorId: string, organizationId: string, raw: z.input<typeof linkInput>) {
  const input = linkInput.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  if (input.scope === "project") {
    const [p] = await conn.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId!), eq(projects.organizationId, organizationId))).limit(1);
    if (!p) throw new AppError("NOT_FOUND", "Project not found");
  }
  const token = randomBytes(32).toString("base64url");
  const [link] = await conn
    .insert(shareLinks)
    .values({
      organizationId,
      projectId: input.scope === "project" ? input.projectId! : null,
      label: input.label,
      tokenHash: hashToken(token),
      passwordHash: input.password ? hashPassword(input.password) : null,
      includeComments: input.includeComments,
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY) : null,
      createdById: actorId,
    })
    .returning();
  await conn.insert(auditLogs).values({
    organizationId, actorId, action: "SHARE_LINK_CREATED", entityType: "share_link", entityId: link!.id,
    metadata: { label: input.label, scope: input.scope, password: !!input.password, expires: input.expiresInDays ?? null },
  });
  return { link: link!, token };
}

export async function listShareLinks(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn
    .select({
      id: shareLinks.id, label: shareLinks.label, projectId: shareLinks.projectId, projectName: projects.name, projectKey: projects.key,
      hasPassword: sql<boolean>`${shareLinks.passwordHash} is not null`, includeComments: shareLinks.includeComments,
      expiresAt: shareLinks.expiresAt, revokedAt: shareLinks.revokedAt, viewCount: shareLinks.viewCount, lastViewedAt: shareLinks.lastViewedAt,
      createdAt: shareLinks.createdAt, createdByName: users.name,
    })
    .from(shareLinks)
    .leftJoin(projects, eq(projects.id, shareLinks.projectId))
    .leftJoin(users, eq(users.id, shareLinks.createdById))
    .where(eq(shareLinks.organizationId, organizationId))
    .orderBy(desc(shareLinks.createdAt));
}

export async function revokeShareLink(conn: DB, actorId: string, organizationId: string, linkId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [l] = await conn
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(shareLinks.id, linkId), eq(shareLinks.organizationId, organizationId), isNull(shareLinks.revokedAt)))
    .returning({ label: shareLinks.label });
  if (!l) throw new AppError("NOT_FOUND", "Link not found or already revoked");
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "SHARE_LINK_REVOKED", entityType: "share_link", entityId: linkId, metadata: { label: l.label } });
}

/* ------------------------------- public access ------------------------------- */

export type ResolvedShare = { link: ShareLink; orgName: string };

/** Look up a token. Any failure is just "not available" (no hints about why). */
export async function resolveShare(conn: DB, token: string): Promise<ResolvedShare | null> {
  if (!TOKEN_RE.test(token)) return null;
  const [row] = await conn
    .select({ link: shareLinks, org: organizations })
    .from(shareLinks)
    .innerJoin(organizations, eq(organizations.id, shareLinks.organizationId))
    .where(eq(shareLinks.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.link.revokedAt || (row.link.expiresAt && row.link.expiresAt.getTime() < Date.now())) return null;
  if (billingState(row.org).access === "locked") return null;
  return { link: row.link, orgName: row.org.name };
}

/** Signed cookie value proving the password was entered (changes if the password changes). */
export function unlockProof(link: ShareLink) {
  const secret = process.env.BETTER_AUTH_SECRET ?? "dev-secret";
  return createHmac("sha256", secret).update(`${link.id}:${link.passwordHash ?? ""}`).digest("base64url");
}

const attempts: Map<string, { n: number; since: number }> = ((globalThis as { __ssShareAttempts?: Map<string, { n: number; since: number }> }).__ssShareAttempts ??= new Map());

/** Check a password with a simple limit: 10 tries per link per 15 minutes. */
export function checkSharePassword(link: ShareLink, password: string, now = Date.now()): "ok" | "wrong" | "limited" {
  const a = attempts.get(link.id);
  const fresh = !a || now - a.since > 15 * 60_000 ? { n: 0, since: now } : a;
  if (fresh.n >= 10) return "limited";
  if (link.passwordHash && passwordMatches(password, link.passwordHash)) {
    attempts.delete(link.id);
    return "ok";
  }
  attempts.set(link.id, { n: fresh.n + 1, since: fresh.since });
  return "wrong";
}

/** The read-only data a share link may show. No emails, no internal ids beyond what the page needs. */
export async function sharedView(conn: DB, share: ResolvedShare, projectKey?: string | null) {
  const { link } = share;
  const allProjects = await conn
    .select({ id: projects.id, key: projects.key, name: projects.name, description: projects.description })
    .from(projects)
    .where(and(eq(projects.organizationId, link.organizationId), link.projectId ? eq(projects.id, link.projectId) : sql`true`))
    .orderBy(asc(projects.key));
  const project = link.projectId ? allProjects[0] : allProjects.find((p) => p.key === projectKey?.toUpperCase()) ?? null;

  // Count the view (at most once a minute per link to keep writes cheap).
  if (!link.lastViewedAt || Date.now() - link.lastViewedAt.getTime() > 60_000) {
    await conn.update(shareLinks).set({ viewCount: sql`${shareLinks.viewCount} + 1`, lastViewedAt: new Date() }).where(eq(shareLinks.id, link.id));
  }
  if (!project) return { orgName: share.orgName, scope: link.projectId ? "project" : "workspace", projects: allProjects, project: null };

  const [columns, rows, tagRows, teamRows] = await Promise.all([
    conn.select({ id: boardColumns.id, title: boardColumns.title, color: boardColumns.color }).from(boardColumns).where(eq(boardColumns.projectId, project.id)).orderBy(asc(boardColumns.position)),
    conn
      .select({ task: tasks, assignee: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.assigneeId))
      .where(and(eq(tasks.organizationId, link.organizationId), eq(tasks.projectId, project.id)))
      .orderBy(asc(tasks.position))
      .limit(1000),
    conn.select({ taskId: taskTags.taskId, name: tags.name, color: tags.color }).from(taskTags).innerJoin(tags, eq(tags.id, taskTags.tagId)).innerJoin(tasks, eq(tasks.id, taskTags.taskId)).where(eq(tasks.projectId, project.id)),
    conn.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams).where(eq(teams.organizationId, link.organizationId)),
  ]);
  const ids = rows.map((r) => r.task.id);
  const [checks, comments] = await Promise.all([
    ids.length
      ? conn
          .select({ taskId: checklistItems.taskId, total: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${checklistItems.done})::int` })
          .from(checklistItems)
          .where(inArray(checklistItems.taskId, ids))
          .groupBy(checklistItems.taskId)
      : Promise.resolve([]),
    link.includeComments && ids.length
      ? conn
          .select({ taskId: taskComments.taskId, body: taskComments.body, createdAt: taskComments.createdAt, author: users.name, viaAutomation: sql<boolean>`${taskComments.automationId} is not null` })
          .from(taskComments)
          .leftJoin(users, eq(users.id, taskComments.authorId))
          .where(inArray(taskComments.taskId, ids))
          .orderBy(asc(taskComments.createdAt))
          .limit(2000)
      : Promise.resolve([]),
  ]);
  const refOf = new Map(rows.map((r) => [r.task.id, `${project.key}-${r.task.taskNumber}`]));
  const teamOf = new Map(teamRows.map((t) => [t.id, t]));
  return {
    orgName: share.orgName,
    scope: link.projectId ? "project" : "workspace",
    projects: allProjects,
    project,
    columns,
    includeComments: link.includeComments,
    tasks: rows.map(({ task: t, assignee }) => ({
      id: t.id,
      ref: refOf.get(t.id)!,
      title: t.title,
      description: t.description,
      columnId: t.columnId,
      priority: t.priority,
      type: t.type,
      assignee: assignee ?? null,
      team: t.teamId ? (teamOf.get(t.teamId) ?? null) : null,
      startDate: t.startDate,
      dueDate: t.dueDate,
      storyPoints: t.storyPoints,
      parentRef: t.parentId ? (refOf.get(t.parentId) ?? null) : null,
      tags: tagRows.filter((g) => g.taskId === t.id).map((g) => ({ name: g.name, color: g.color })),
      checklist: checks.find((c) => c.taskId === t.id) ?? null,
      comments: comments
        .filter((c) => c.taskId === t.id)
        .map((c) => ({ author: c.viaAutomation ? "Automation" : (c.author ?? "Former member"), body: c.body.replace(/@\[([^\]\n]{1,80})\]\([^)]{1,60}\)/g, "@$1"), createdAt: c.createdAt.toISOString() })),
    })),
  };
}
