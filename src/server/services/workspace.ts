import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import {
  auditLogs,
  boardColumns,
  orgInvites,
  orgMembers,
  organizations,
  projects,
  tasks,
  users,
  type OrgRole,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/fractional-index";
import { hasRole, requireOrgBySlug, requireOrgPermission } from "@/lib/rbac";

export const roleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export const DEFAULT_COLUMNS = ["Backlog", "In Progress", "Review", "Done"] as const;

export function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workspace"
  );
}

/* ----------------------------- organizations ----------------------------- */

export async function listMyOrganizations(conn: DB, userId: string) {
  return conn
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: orgMembers.role,
      isDemo: organizations.isDemo,
      createdAt: organizations.createdAt,
      // Correlated counts; qualified explicitly (drizzle emits bare column names in sql``).
      memberCount: sql<number>`(select count(*)::int from org_members m where m.organization_id = "organizations"."id")`,
      projectCount: sql<number>`(select count(*)::int from projects p where p.organization_id = "organizations"."id")`,
      taskCount: sql<number>`(select count(*)::int from tasks t where t.organization_id = "organizations"."id")`,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organizationId))
    .where(eq(orgMembers.userId, userId))
    .orderBy(asc(organizations.name));
}

export async function createOrganization(
  conn: DB,
  userId: string,
  raw: { name: string; isDemo?: boolean; slug?: string }
) {
  const name = z.string().trim().min(2).max(120).parse(raw.name);
  return conn.transaction(async (tx) => {
    const base = raw.slug ?? slugify(name);
    let slug = base;
    for (let i = 0; i < 5; i++) {
      const [taken] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
      if (!taken) break;
      slug = `${base}-${randomBytes(2).toString("hex")}`;
    }
    const [org] = await tx.insert(organizations).values({ name, slug, isDemo: !!raw.isDemo }).returning();
    await tx.insert(orgMembers).values({ organizationId: org!.id, userId, role: "owner" });
    await tx.insert(auditLogs).values({
      organizationId: org!.id,
      actorId: userId,
      action: "ORG_CREATED",
      entityType: "organization",
      entityId: org!.id,
      metadata: { name },
    });
    return org!;
  });
}

/* -------------------------------- projects -------------------------------- */

export const createProjectInput = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, "Key must be 2–10 letters/digits, starting with a letter"),
  description: z.string().max(2_000).nullish(),
});

export async function createProject(conn: DB, actorId: string, raw: z.input<typeof createProjectInput>) {
  const input = createProjectInput.parse(raw);
  await requireOrgPermission(actorId, input.organizationId, "admin", conn);

  return conn.transaction(async (tx) => {
    const [dupe] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.organizationId, input.organizationId), eq(projects.key, input.key)))
      .limit(1);
    if (dupe) throw new AppError("CONFLICT", `Project key ${input.key} is already used`);

    const [project] = await tx
      .insert(projects)
      .values({ organizationId: input.organizationId, name: input.name, key: input.key, description: input.description ?? null })
      .returning();
    await tx.insert(boardColumns).values(
      DEFAULT_COLUMNS.map((title, i) => ({
        organizationId: input.organizationId,
        projectId: project!.id,
        title,
        position: (i + 1) * POSITION_STEP,
      }))
    );
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorId,
      action: "PROJECT_CREATED",
      entityType: "project",
      entityId: project!.id,
      metadata: { name: input.name, key: input.key },
    });
    return project!;
  });
}

export async function listProjects(conn: DB, userId: string, orgSlug: string) {
  const { org, role } = await requireOrgBySlug(userId, orgSlug, "viewer", conn);
  const rows = await conn
    .select({
      id: projects.id,
      name: projects.name,
      key: projects.key,
      description: projects.description,
      // Correlated subquery: qualify explicitly (drizzle emits bare column names here).
      taskCount: sql<number>`(select count(*)::int from tasks t where t.project_id = "projects"."id")`,
    })
    .from(projects)
    .where(eq(projects.organizationId, org.id))
    .orderBy(asc(projects.createdAt));
  return { org, role, projects: rows };
}

/* --------------------------------- board --------------------------------- */

export async function getBoard(conn: DB, userId: string, orgSlug: string, projectKey: string) {
  const { org, role } = await requireOrgBySlug(userId, orgSlug, "viewer", conn);
  const [project] = await conn
    .select()
    .from(projects)
    .where(and(eq(projects.organizationId, org.id), eq(projects.key, projectKey.toUpperCase())))
    .limit(1);
  if (!project) throw new AppError("NOT_FOUND", "Project not found");

  const [columns, taskRows, members] = await Promise.all([
    conn
      .select()
      .from(boardColumns)
      .where(and(eq(boardColumns.organizationId, org.id), eq(boardColumns.projectId, project.id)))
      .orderBy(asc(boardColumns.position)),
    conn
      .select()
      .from(tasks)
      .where(and(eq(tasks.organizationId, org.id), eq(tasks.projectId, project.id)))
      .orderBy(asc(tasks.position)),
    listMembersForOrg(conn, org.id),
  ]);
  return { org, role, project, columns, tasks: taskRows, members };
}

/* -------------------------------- members -------------------------------- */

async function listMembersForOrg(conn: DB, organizationId: string) {
  return conn
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      role: orgMembers.role,
      joinedAt: orgMembers.joinedAt,
    })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(eq(orgMembers.organizationId, organizationId))
    .orderBy(asc(orgMembers.joinedAt));
}

export async function listMembers(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return listMembersForOrg(conn, organizationId);
}

async function ownerCount(conn: Pick<DB, "select">, organizationId: string) {
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.role, "owner")));
  return row?.n ?? 0;
}

/**
 * Role changes:
 *  - admins+ may change roles; only owners may grant/revoke `owner` or touch another owner
 *  - the last owner can never be demoted (the org must stay administrable)
 */
export async function changeMemberRole(
  conn: DB,
  actorId: string,
  raw: { organizationId: string; userId: string; role: OrgRole }
) {
  const input = z.object({ organizationId: z.string().uuid(), userId: z.string().uuid(), role: roleSchema }).parse(raw);
  const actorRole = await requireOrgPermission(actorId, input.organizationId, "admin", conn);

  return conn.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.organizationId, input.organizationId), eq(orgMembers.userId, input.userId)))
      .limit(1);
    if (!target) throw new AppError("NOT_FOUND", "Member not found");

    const touchesOwner = target.role === "owner" || input.role === "owner";
    if (touchesOwner && actorRole !== "owner") {
      throw new AppError("FORBIDDEN_REQUIRES_OWNER", "Only owners can grant or revoke ownership");
    }
    if (target.role === "owner" && input.role !== "owner" && (await ownerCount(tx, input.organizationId)) <= 1) {
      throw new AppError("CONFLICT", "A workspace must keep at least one owner");
    }
    if (target.role === input.role) return { from: target.role, to: input.role };

    await tx
      .update(orgMembers)
      .set({ role: input.role })
      .where(and(eq(orgMembers.organizationId, input.organizationId), eq(orgMembers.userId, input.userId)));
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorId,
      action: "MEMBER_ROLE_UPDATED",
      entityType: "member",
      entityId: input.userId,
      metadata: { from: target.role, to: input.role },
    });
    return { from: target.role, to: input.role };
  });
}

export async function removeMember(conn: DB, actorId: string, organizationId: string, userId: string) {
  const isSelf = actorId === userId;
  const actorRole = await requireOrgPermission(actorId, organizationId, isSelf ? "viewer" : "admin", conn);
  return conn.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, userId)))
      .limit(1);
    if (!target) throw new AppError("NOT_FOUND", "Member not found");
    if (target.role === "owner" && !isSelf && actorRole !== "owner") {
      throw new AppError("FORBIDDEN_REQUIRES_OWNER");
    }
    if (target.role === "owner" && (await ownerCount(tx, organizationId)) <= 1) {
      throw new AppError("CONFLICT", "A workspace must keep at least one owner");
    }
    await tx.delete(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, userId)));
    await tx.insert(auditLogs).values({
      organizationId,
      actorId,
      action: isSelf ? "MEMBER_LEFT" : "MEMBER_REMOVED",
      entityType: "member",
      entityId: userId,
      metadata: { role: target.role },
    });
  });
}

/* -------------------------------- invites -------------------------------- */

export async function createInvite(
  conn: DB,
  actorId: string,
  raw: { organizationId: string; email: string; role: OrgRole }
) {
  const input = z
    .object({ organizationId: z.string().uuid(), email: z.string().trim().toLowerCase().email(), role: roleSchema })
    .parse(raw);
  const actorRole = await requireOrgPermission(actorId, input.organizationId, "admin", conn);
  if (input.role === "owner" && actorRole !== "owner") throw new AppError("FORBIDDEN_REQUIRES_OWNER");

  const token = randomBytes(32).toString("base64url");
  return conn.transaction(async (tx) => {
    const [invite] = await tx
      .insert(orgInvites)
      .values({
        organizationId: input.organizationId,
        email: input.email,
        role: input.role,
        token,
        invitedById: actorId,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      })
      .returning();
    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorId,
      action: "INVITE_CREATED",
      entityType: "invite",
      entityId: invite!.id,
      metadata: { email: input.email, role: input.role },
    });
    return invite!;
  });
}

export async function listInvites(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn
    .select()
    .from(orgInvites)
    .where(and(eq(orgInvites.organizationId, organizationId), eq(orgInvites.status, "pending")))
    .orderBy(desc(orgInvites.createdAt));
}

export async function revokeInvite(conn: DB, actorId: string, organizationId: string, inviteId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const [inv] = await tx
      .update(orgInvites)
      .set({ status: "revoked" })
      .where(and(eq(orgInvites.id, inviteId), eq(orgInvites.organizationId, organizationId), eq(orgInvites.status, "pending")))
      .returning();
    if (!inv) throw new AppError("NOT_FOUND", "Invite not found");
    await tx.insert(auditLogs).values({
      organizationId,
      actorId,
      action: "INVITE_REVOKED",
      entityType: "invite",
      entityId: inv.id,
      metadata: { email: inv.email },
    });
  });
}

/** Public preview for /invite/[token] (no membership required — the token is the capability). */
export async function getInvitePreview(conn: DB, token: string) {
  const [row] = await conn
    .select({ invite: orgInvites, orgName: organizations.name, orgSlug: organizations.slug })
    .from(orgInvites)
    .innerJoin(organizations, eq(organizations.id, orgInvites.organizationId))
    .where(eq(orgInvites.token, token))
    .limit(1);
  return row ?? null;
}

export async function acceptInvite(conn: DB, userId: string, token: string) {
  return conn.transaction(async (tx) => {
    const [row] = await tx
      .select({ invite: orgInvites, email: users.email })
      .from(orgInvites)
      .innerJoin(users, eq(users.id, userId))
      .where(eq(orgInvites.token, token))
      .limit(1);
    if (!row || row.invite.status !== "pending") throw new AppError("NOT_FOUND", "Invite is invalid or already used");
    if (row.invite.expiresAt.getTime() < Date.now()) throw new AppError("NOT_FOUND", "Invite has expired");
    if (row.invite.email.toLowerCase() !== row.email.toLowerCase()) {
      throw new AppError("FORBIDDEN", `This invite was sent to ${row.invite.email}`);
    }

    // Accepting never downgrades an existing membership.
    const [existing] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.organizationId, row.invite.organizationId), eq(orgMembers.userId, userId)))
      .limit(1);
    if (!existing) {
      await tx.insert(orgMembers).values({ organizationId: row.invite.organizationId, userId, role: row.invite.role });
    } else if (!hasRole(existing.role, row.invite.role)) {
      await tx
        .update(orgMembers)
        .set({ role: row.invite.role })
        .where(and(eq(orgMembers.organizationId, row.invite.organizationId), eq(orgMembers.userId, userId)));
    }
    await tx.update(orgInvites).set({ status: "accepted" }).where(eq(orgInvites.id, row.invite.id));
    await tx.insert(auditLogs).values({
      organizationId: row.invite.organizationId,
      actorId: userId,
      action: "INVITE_ACCEPTED",
      entityType: "member",
      entityId: userId,
      metadata: { role: row.invite.role, inviteId: row.invite.id },
    });
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, row.invite.organizationId));
    return org!;
  });
}

/* ---------------------------------- audit --------------------------------- */

export const AUDIT_ACTIONS = [
  "TASK_CREATED",
  "TASK_MOVED",
  "TASK_UPDATED",
  "TASK_DELETED",
  "COMMENT_ADDED",
  "PROJECT_CREATED",
  "MEMBER_ROLE_UPDATED",
  "MEMBER_REMOVED",
  "MEMBER_LEFT",
  "INVITE_CREATED",
  "INVITE_ACCEPTED",
  "INVITE_REVOKED",
  "ORG_CREATED",
  "AI_SUBTASKS_ADDED",
] as const;

export async function listAuditLogs(
  conn: DB,
  actorId: string,
  organizationId: string,
  filters: { actorId?: string; action?: string; before?: Date; limit?: number } = {}
) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const conds = [eq(auditLogs.organizationId, organizationId)];
  if (filters.actorId) conds.push(eq(auditLogs.actorId, filters.actorId));
  if (filters.action) conds.push(eq(auditLogs.action, filters.action));
  if (filters.before) conds.push(lt(auditLogs.createdAt, filters.before));
  return conn
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorId: auditLogs.actorId,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(...conds))
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(filters.limit ?? 50, 200));
}

/** Resolve task refs (ENG-12) for audit display, tenant-scoped. */
export async function taskRefs(conn: DB, organizationId: string, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, string>();
  const rows = await conn
    .select({ id: tasks.id, n: tasks.taskNumber, key: projects.key, title: tasks.title })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.organizationId, organizationId), inArray(tasks.id, taskIds)));
  return new Map(rows.map((r) => [r.id, `${r.key}-${r.n} ${r.title}`]));
}

/* ------------------------------ dashboards ------------------------------ */

/**
 * Created vs completed per UTC day for one project, from the audit log.
 * "Completed" = a TASK_MOVED into the project's last (done) column.
 * Tenant-scoped after RBAC; bounded by `days` so it stays cheap.
 */
export async function projectFlowSeries(conn: DB, actorId: string, organizationId: string, projectId: string, days = 14) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const span = Math.min(Math.max(Math.trunc(days), 1), 90);

  const cols = await conn
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(and(eq(boardColumns.organizationId, organizationId), eq(boardColumns.projectId, projectId)))
    .orderBy(asc(boardColumns.position));
  if (cols.length === 0) throw new AppError("NOT_FOUND", "Project not found");
  const doneColumnId = cols[cols.length - 1]!.id;

  const end = new Date();
  const startDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - (span - 1)));
  const rows = await conn
    .select({ action: auditLogs.action, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .innerJoin(tasks, and(eq(tasks.id, auditLogs.entityId), eq(tasks.organizationId, organizationId)))
    .where(
      and(
        eq(auditLogs.organizationId, organizationId),
        eq(tasks.projectId, projectId),
        inArray(auditLogs.action, ["TASK_CREATED", "TASK_MOVED"]),
        gte(auditLogs.createdAt, startDay)
      )
    )
    .limit(10_000);

  const series = Array.from({ length: span }, (_, i) => ({
    day: new Date(startDay.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    created: 0,
    completed: 0,
  }));
  const index = new Map(series.map((s, i) => [s.day, i]));
  for (const r of rows) {
    const i = index.get(r.createdAt.toISOString().slice(0, 10));
    if (i === undefined) continue;
    if (r.action === "TASK_CREATED") series[i]!.created++;
    else if (r.metadata.targetColumnId === doneColumnId) series[i]!.completed++;
  }
  return series;
}
