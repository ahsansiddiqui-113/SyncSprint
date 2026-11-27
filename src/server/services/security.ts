import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import * as s from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { ipAllowed, validateAllowlist } from "@/lib/ip";
import { toCsv } from "@/lib/csv";

/**
 * Workspace security settings (admins): require two-step sign-in, IP allow-list,
 * audit retention; plus the admin exports (audit log CSV, whole workspace JSON).
 */

const DAY = 86_400_000;
export const MIN_AUDIT_RETENTION_DAYS = 90;

async function org(conn: DB, organizationId: string) {
  const [o] = await conn.select().from(s.organizations).where(eq(s.organizations.id, organizationId)).limit(1);
  if (!o) throw new AppError("NOT_FOUND");
  return o;
}

export async function getSecuritySettings(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const o = await org(conn, organizationId);
  const people = await conn
    .select({ userId: s.users.id, name: s.users.name, email: s.users.email, role: s.orgMembers.role, twoFactorEnabled: s.users.twoFactorEnabled })
    .from(s.orgMembers)
    .innerJoin(s.users, eq(s.users.id, s.orgMembers.userId))
    .where(eq(s.orgMembers.organizationId, organizationId))
    .orderBy(asc(s.users.name));
  return {
    require2fa: o.require2fa,
    ipAllowlist: o.ipAllowlist ?? "",
    auditRetentionDays: o.auditRetentionDays,
    ssoRequired: o.ssoRequired,
    scimEnabled: !!o.scimTokenHash,
    without2fa: people.filter((p) => !p.twoFactorEnabled).map(({ userId, name, email, role }) => ({ userId, name, email, role })),
    members: people.length,
  };
}

async function audit(conn: DB, organizationId: string, actorId: string, action: string, metadata: Record<string, unknown>) {
  await conn.insert(s.auditLogs).values({ organizationId, actorId, action, entityType: "organization", entityId: organizationId, metadata });
}

export async function setRequire2fa(conn: DB, actorId: string, organizationId: string, on: boolean) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  if (on) {
    const [me] = await conn.select({ on: s.users.twoFactorEnabled }).from(s.users).where(eq(s.users.id, actorId)).limit(1);
    if (!me?.on) throw new AppError("VALIDATION", "Turn on two-step sign-in for your own account first, so you don't lock yourself out.");
  }
  await conn.update(s.organizations).set({ require2fa: on }).where(eq(s.organizations.id, organizationId));
  await audit(conn, organizationId, actorId, on ? "SECURITY_2FA_REQUIRED" : "SECURITY_2FA_OPTIONAL", {});
}

/** `callerIp` is the admin's own address: saving a list that excludes it is refused (no self-lockout). */
export async function setIpAllowlist(conn: DB, actorId: string, organizationId: string, text: string, callerIp: string | null | undefined) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  if (text.length > 10_000) throw new AppError("VALIDATION", "That list is too long");
  const v = validateAllowlist(text);
  if (!v.ok) throw new AppError("VALIDATION", `"${v.line}" isn't an IP address or range (examples: 203.0.113.7, 10.0.0.0/8, 2001:db8::/32)`);
  if (v.count > 200) throw new AppError("VALIDATION", "Up to 200 entries");
  if (v.count && callerIp !== undefined && !ipAllowed(callerIp, v.cleaned)) {
    throw new AppError("VALIDATION", `Your current address (${callerIp ?? "unknown"}) isn't on the list; saving it would lock you out.`);
  }
  await conn.update(s.organizations).set({ ipAllowlist: v.count ? v.cleaned : null }).where(eq(s.organizations.id, organizationId));
  await audit(conn, organizationId, actorId, "SECURITY_IP_ALLOWLIST", { entries: v.count });
  return { entries: v.count };
}

export async function setAuditRetention(conn: DB, actorId: string, organizationId: string, days: number | null) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const d = z.number().int().min(MIN_AUDIT_RETENTION_DAYS, `Keep at least ${MIN_AUDIT_RETENTION_DAYS} days`).max(3650).nullable().parse(days);
  await conn.update(s.organizations).set({ auditRetentionDays: d }).where(eq(s.organizations.id, organizationId));
  await audit(conn, organizationId, actorId, "SECURITY_AUDIT_RETENTION", { days: d });
}

/** Scheduler: delete audit entries past each workspace's retention. */
export async function purgeAuditLogs(conn: DB, now = new Date()) {
  const orgs = await conn.select({ id: s.organizations.id, days: s.organizations.auditRetentionDays }).from(s.organizations).where(sql`${s.organizations.auditRetentionDays} is not null`);
  let removed = 0;
  for (const o of orgs) {
    const cutoff = new Date(now.getTime() - Math.max(MIN_AUDIT_RETENTION_DAYS, o.days!) * DAY);
    const gone = await conn.delete(s.auditLogs).where(and(eq(s.auditLogs.organizationId, o.id), lt(s.auditLogs.createdAt, cutoff))).returning({ id: s.auditLogs.id });
    removed += gone.length;
  }
  return removed;
}

/* ---------------------------------- exports ---------------------------------- */

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function exportAuditCsv(conn: DB, actorId: string, organizationId: string, range: { from?: string | null; to?: string | null }) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const from = range.from ? isoDay.parse(range.from) : null;
  const to = range.to ? isoDay.parse(range.to) : null;
  const rows = await conn
    .select({ at: s.auditLogs.createdAt, actor: s.users.name, actorEmail: s.users.email, action: s.auditLogs.action, entityType: s.auditLogs.entityType, entityId: s.auditLogs.entityId, metadata: s.auditLogs.metadata })
    .from(s.auditLogs)
    .leftJoin(s.users, eq(s.users.id, s.auditLogs.actorId))
    .where(and(
      eq(s.auditLogs.organizationId, organizationId),
      from ? gte(s.auditLogs.createdAt, new Date(`${from}T00:00:00Z`)) : undefined,
      to ? lte(s.auditLogs.createdAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
    ))
    .orderBy(asc(s.auditLogs.createdAt))
    .limit(100_000);
  await audit(conn, organizationId, actorId, "AUDIT_EXPORTED", { rows: rows.length, from, to });
  return toCsv([
    ["time (UTC)", "actor", "actor email", "action", "entity type", "entity id", "details"],
    ...rows.map((r) => [r.at.toISOString(), r.actor ?? "system", r.actorEmail ?? "", r.action, r.entityType, r.entityId, JSON.stringify(r.metadata)]),
  ]);
}

/**
 * Everything the workspace owns, as JSON, for backup or leaving. Secrets are left out
 * (API key hashes, webhook / chat / repository secrets, share-link hashes, SCIM token).
 */
export async function exportWorkspace(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const o = await org(conn, organizationId);
  const taskIds = (await conn.select({ id: s.tasks.id }).from(s.tasks).where(eq(s.tasks.organizationId, organizationId))).map((t) => t.id);
  const inTasks = (c: import("drizzle-orm/pg-core").PgColumn) => (taskIds.length ? inArray(c, taskIds) : sql`false`);

  const data = {
    format: "syncsprint-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    organization: { id: o.id, name: o.name, slug: o.slug, plan: o.plan, createdAt: o.createdAt },
    members: await (conn.select({ userId: s.users.id, name: s.users.name, email: s.users.email, role: s.orgMembers.role, joinedAt: s.orgMembers.joinedAt }).from(s.orgMembers).innerJoin(s.users, eq(s.users.id, s.orgMembers.userId)).where(eq(s.orgMembers.organizationId, organizationId))),
    groups: await conn.select().from(s.teams).where(eq(s.teams.organizationId, organizationId)),
    groupMembers: await conn.select().from(s.teamMembers).where(eq(s.teamMembers.organizationId, organizationId)),
    projects: await conn.select().from(s.projects).where(eq(s.projects.organizationId, organizationId)),
    statuses: await conn.select().from(s.boardColumns).where(eq(s.boardColumns.organizationId, organizationId)),
    sprints: await conn.select().from(s.sprints).where(eq(s.sprints.organizationId, organizationId)),
    tasks: await conn.select().from(s.tasks).where(eq(s.tasks.organizationId, organizationId)),
    checklistItems: await conn.select().from(s.checklistItems).where(inTasks(s.checklistItems.taskId)),
    tags: await conn.select().from(s.tags).where(eq(s.tags.organizationId, organizationId)),
    taskTags: await conn.select().from(s.taskTags).where(inTasks(s.taskTags.taskId)),
    dependencies: await conn.select().from(s.taskDependencies).where(eq(s.taskDependencies.organizationId, organizationId)),
    customFields: await conn.select().from(s.customFields).where(eq(s.customFields.organizationId, organizationId)),
    customFieldValues: await conn.select().from(s.taskFieldValues).where(inTasks(s.taskFieldValues.taskId)),
    coAssignees: await conn.select().from(s.taskAssignees).where(inTasks(s.taskAssignees.taskId)),
    watchers: await conn.select().from(s.taskWatchers).where(inTasks(s.taskWatchers.taskId)),
    comments: await conn.select().from(s.taskComments).where(eq(s.taskComments.organizationId, organizationId)),
    timeEntries: await conn.select().from(s.timeEntries).where(eq(s.timeEntries.organizationId, organizationId)),
    attachments: (await conn.select().from(s.attachments).where(eq(s.attachments.organizationId, organizationId))).map(({ ...a }) => {
      const r = a as Record<string, unknown>;
      delete r.data; // file bytes stay out of the JSON; download them from the app
      return r;
    }),
    docs: await conn.select().from(s.docs).where(eq(s.docs.organizationId, organizationId)),
    goals: await conn.select().from(s.goals).where(eq(s.goals.organizationId, organizationId)),
    keyResults: await conn.select().from(s.keyResults).where(eq(s.keyResults.organizationId, organizationId)),
    automations: await conn.select().from(s.automations).where(eq(s.automations.organizationId, organizationId)),
    savedViews: await conn.select().from(s.savedViews).where(eq(s.savedViews.organizationId, organizationId)),
    whiteboards: await conn.select().from(s.whiteboards).where(eq(s.whiteboards.organizationId, organizationId)),
    whiteboardItems: await conn.select().from(s.whiteboardItems).where(eq(s.whiteboardItems.organizationId, organizationId)),
    baselines: await conn.select().from(s.baselines).where(eq(s.baselines.organizationId, organizationId)),
    projectTemplates: await conn.select().from(s.projectTemplates).where(eq(s.projectTemplates.organizationId, organizationId)),
    taskTemplates: await conn.select().from(s.taskTemplates).where(eq(s.taskTemplates.organizationId, organizationId)),
    forms: (await conn.select().from(s.forms).where(eq(s.forms.organizationId, organizationId))).map(({ token: _t, ...f }) => f),
  };
  await audit(conn, organizationId, actorId, "WORKSPACE_EXPORTED", { tasks: data.tasks.length, projects: data.projects.length });
  return data;
}
