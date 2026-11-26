import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import { auditLogs, boardColumns, orgMembers, projects, teamMembers, teams, tasks, timeEntries, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { isAdminRole } from "@/lib/rbac-shared";
import { TAG_COLORS } from "@/lib/tag-colors";
import { workloadFor, resolveToday } from "./capacity";

/**
 * Groups (teams): QA, Developers, Marketing... A group has members and an optional lead.
 *  - admins create, rename and delete groups; admins or the group's lead manage its members
 *  - tasks can be assigned to a group: they sit in the group's queue until someone takes them
 *  - @handle in a comment notifies everyone in the group
 *  - group tracking: queue, overdue, finished per week, hours logged, this week's workload
 */

const DAY = 86_400_000;
export const toHandle = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "group";

async function membersOf(conn: DbOrTx, organizationId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await conn.select({ id: orgMembers.userId }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), inArray(orgMembers.userId, ids)));
  return new Set(rows.map((r) => r.id));
}

async function teamInOrg(conn: DbOrTx, organizationId: string, teamId: string) {
  const [t] = await conn.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.organizationId, organizationId))).limit(1);
  if (!t) throw new AppError("NOT_FOUND", "Group not found");
  return t;
}

/** Group exists in this workspace (used by task create/update and automations). */
export async function assertTeamInOrg(conn: DbOrTx, organizationId: string, teamId: string | null | undefined) {
  if (teamId) await teamInOrg(conn, organizationId, teamId);
}

export async function listTeams(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const rows = await conn.select().from(teams).where(eq(teams.organizationId, organizationId)).orderBy(asc(teams.name));
  const links = rows.length ? await conn.select({ teamId: teamMembers.teamId, userId: teamMembers.userId }).from(teamMembers).where(eq(teamMembers.organizationId, organizationId)) : [];
  return rows.map((t) => ({
    id: t.id, name: t.name, handle: t.handle, color: t.color, description: t.description, leadId: t.leadId,
    memberIds: links.filter((l) => l.teamId === t.id).map((l) => l.userId),
  }));
}

const teamInput = z.object({
  name: z.string().trim().min(1, "Name the group").max(60),
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Handles use letters, numbers and dashes").optional(),
  color: z.enum(TAG_COLORS).optional(),
  description: z.string().trim().max(300).nullish(),
  leadId: z.string().uuid().nullish(),
  memberIds: z.array(z.string().uuid()).max(500).optional(),
});

async function assertUnique(conn: DbOrTx, organizationId: string, name: string, handle: string, exceptId?: string) {
  const clash = await conn
    .select({ id: teams.id, name: teams.name, handle: teams.handle })
    .from(teams)
    .where(and(eq(teams.organizationId, organizationId), or(sql`lower(${teams.name}) = ${name.toLowerCase()}`, eq(teams.handle, handle))));
  const other = clash.find((c) => c.id !== exceptId);
  if (other) throw new AppError("CONFLICT", other.handle === handle ? `@${handle} is already used by another group` : `There's already a group called ${other.name}`);
}

export async function createTeam(conn: DB, actorId: string, organizationId: string, raw: z.input<typeof teamInput>) {
  const input = teamInput.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const handle = input.handle ?? toHandle(input.name);
  return conn.transaction(async (tx) => {
    await assertUnique(tx, organizationId, input.name, handle);
    const ids = [...new Set([...(input.memberIds ?? []), ...(input.leadId ? [input.leadId] : [])])];
    const valid = await membersOf(tx, organizationId, ids);
    if (valid.size !== ids.length) throw new AppError("VALIDATION", "Everyone in a group must be in this workspace");
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(teams).where(eq(teams.organizationId, organizationId))) as [{ n: number }];
    const [t] = await tx
      .insert(teams)
      .values({ organizationId, name: input.name, handle, color: input.color ?? TAG_COLORS[n % TAG_COLORS.length]!, description: input.description ?? null, leadId: input.leadId ?? null })
      .returning();
    if (ids.length) await tx.insert(teamMembers).values(ids.map((userId) => ({ organizationId, teamId: t!.id, userId })));
    await tx.insert(auditLogs).values({ organizationId, actorId, action: "GROUP_CREATED", entityType: "team", entityId: t!.id, metadata: { name: input.name, members: ids.length } });
    return t!;
  });
}

/** Admins can change everything; a group's lead can edit its details and members (not the lead). */
export async function updateTeam(conn: DB, actorId: string, organizationId: string, teamId: string, raw: Partial<z.input<typeof teamInput>>) {
  const input = teamInput.partial().parse(raw);
  const role = await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const t = await teamInOrg(tx, organizationId, teamId);
    const admin = isAdminRole(role);
    if (!admin && t.leadId !== actorId) throw new AppError("FORBIDDEN", "Only admins or this group's lead can change it");
    if (!admin && input.leadId !== undefined && input.leadId !== t.leadId) throw new AppError("FORBIDDEN", "Only admins can change a group's lead");
    const name = input.name ?? t.name;
    const handle = input.handle ?? (input.name ? toHandle(input.name) : t.handle);
    if (name !== t.name || handle !== t.handle) await assertUnique(tx, organizationId, name, handle, teamId);
    if (input.leadId) {
      const ok = await membersOf(tx, organizationId, [input.leadId]);
      if (!ok.size) throw new AppError("VALIDATION", "The lead must be in this workspace");
    }
    const [updated] = await tx
      .update(teams)
      .set({
        name, handle,
        ...(input.color ? { color: input.color } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.leadId !== undefined ? { leadId: input.leadId ?? null } : {}),
      })
      .where(eq(teams.id, teamId))
      .returning();
    if (input.memberIds) {
      const ids = [...new Set([...input.memberIds, ...(updated!.leadId ? [updated!.leadId] : [])])];
      const valid = await membersOf(tx, organizationId, ids);
      if (valid.size !== ids.length) throw new AppError("VALIDATION", "Everyone in a group must be in this workspace");
      await tx.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
      if (ids.length) await tx.insert(teamMembers).values(ids.map((userId) => ({ organizationId, teamId, userId })));
    }
    await tx.insert(auditLogs).values({ organizationId, actorId, action: "GROUP_UPDATED", entityType: "team", entityId: teamId, metadata: { name } });
    return updated!;
  });
}

export async function deleteTeam(conn: DB, actorId: string, organizationId: string, teamId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [t] = await conn.delete(teams).where(and(eq(teams.id, teamId), eq(teams.organizationId, organizationId))).returning({ name: teams.name });
  if (!t) throw new AppError("NOT_FOUND", "Group not found");
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "GROUP_DELETED", entityType: "team", entityId: teamId, metadata: { name: t.name } });
}

/** Members of the given groups within a workspace (for @group mentions). */
export async function teamMemberIds(conn: DbOrTx, organizationId: string, teamIds: string[]) {
  if (!teamIds.length) return [];
  const rows = await conn
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.organizationId, organizationId), inArray(teamMembers.teamId, teamIds)));
  return [...new Set(rows.map((r) => r.userId))];
}

/* ---------------------------------- tracking ---------------------------------- */

export async function teamStats(conn: DB, actorId: string, organizationId: string, teamId: string, clientToday?: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const team = await teamInOrg(conn, organizationId, teamId);
  const today = resolveToday(clientToday);
  const members = await conn
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(users.name));
  const ids = members.map((m) => m.id);

  // "Done" = each project's last status.
  const lastCols = await conn
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(and(eq(boardColumns.organizationId, organizationId), sql`"board_columns"."position" = (select max(b2.position) from board_columns b2 where b2.project_id = "board_columns"."project_id")`));
  const doneIds = lastCols.map((c) => c.id);
  const notDone = doneIds.length ? sql`${tasks.columnId} not in (${sql.join(doneIds.map((d) => sql`${d}`), sql`, `)})` : sql`true`;
  const belongs = ids.length ? or(eq(tasks.teamId, teamId), inArray(tasks.assigneeId, ids)) : eq(tasks.teamId, teamId);

  const [queue, open, overdue] = await Promise.all([
    conn
      .select({ id: tasks.id, title: tasks.title, taskNumber: tasks.taskNumber, key: projects.key, priority: tasks.priority, dueDate: tasks.dueDate })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.teamId, teamId), isNull(tasks.assigneeId), notDone))
      .orderBy(asc(tasks.dueDate), asc(tasks.createdAt))
      .limit(50),
    conn.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.organizationId, organizationId), belongs, notDone)),
    conn.select({ n: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.organizationId, organizationId), belongs, notDone, lt(tasks.dueDate, today))),
  ]);

  // Finished per week (last 4 weeks) from the audit trail of moves into Done.
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 27 * DAY);
  const doneMoves = doneIds.length
    ? await conn
        .select({ at: auditLogs.createdAt, taskId: auditLogs.entityId })
        .from(auditLogs)
        .innerJoin(tasks, eq(tasks.id, auditLogs.entityId))
        .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.action, "TASK_MOVED"), gte(auditLogs.createdAt, since), belongs, sql`${auditLogs.metadata}->>'targetColumnId' in (${sql.join(doneIds.map((d) => sql`${d}`), sql`, `)})`))
    : [];
  const weeks = [3, 2, 1, 0].map((w) => {
    const end = Date.parse(`${today}T00:00:00Z`) + DAY - w * 7 * DAY;
    const start = end - 7 * DAY;
    const label = new Date(start).toISOString().slice(5, 10);
    return { label, done: new Set(doneMoves.filter((m) => m.at.getTime() >= start && m.at.getTime() < end).map((m) => m.taskId)).size };
  });

  const hours = ids.length
    ? await conn
        .select({ userId: timeEntries.userId, minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
        .from(timeEntries)
        .where(and(eq(timeEntries.organizationId, organizationId), inArray(timeEntries.userId, ids), gte(timeEntries.startedAt, new Date(Date.parse(`${today}T00:00:00Z`) - 6 * DAY))))
        .groupBy(timeEntries.userId)
    : [];

  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - weekday * DAY).toISOString().slice(0, 10);
  const to = new Date(Date.parse(`${from}T00:00:00Z`) + 6 * DAY).toISOString().slice(0, 10);
  const load = ids.length ? (await workloadFor(conn, organizationId, { from, to }, ids, today)).people : [];

  return {
    team: { id: team.id, name: team.name, handle: team.handle, color: team.color, description: team.description, leadId: team.leadId },
    members: members.map((m) => {
      const w = load.find((p) => p.userId === m.id);
      return {
        ...m,
        hoursThisWeek: Math.round(((hours.find((h) => h.userId === m.id)?.minutes ?? 0) / 60) * 10) / 10,
        load: w ? { planned: w.totalLoad, capacity: w.totalCapacity, status: w.status } : null,
      };
    }),
    queue: queue.map((q) => ({ id: q.id, ref: `${q.key}-${q.taskNumber}`, projectKey: q.key, title: q.title, priority: q.priority, dueDate: q.dueDate })),
    openTasks: open[0]?.n ?? 0,
    overdue: overdue[0]?.n ?? 0,
    weeks,
    week: { from, to },
  };
}
