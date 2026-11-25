import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import { auditLogs, boardColumns, projects, sprintSnapshots, sprints, tasks, type Sprint } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Sprints (iterations). Lifecycle: planned → active → completed.
 * - one active sprint per project (also a partial unique index in Postgres)
 * - snapshots are upserted per UTC day whenever sprint scope or progress changes,
 *   which is what burndown / burnup / velocity are drawn from
 */

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const utcToday = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function doneColumnId(conn: DbOrTx, organizationId: string, projectId: string) {
  const [col] = await conn
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(and(eq(boardColumns.organizationId, organizationId), eq(boardColumns.projectId, projectId)))
    .orderBy(desc(boardColumns.position))
    .limit(1);
  return col?.id ?? null;
}

async function sprintInOrg(conn: DbOrTx, organizationId: string, sprintId: string) {
  const [s] = await conn
    .select()
    .from(sprints)
    .where(and(eq(sprints.id, sprintId), eq(sprints.organizationId, organizationId)))
    .limit(1);
  if (!s) throw new AppError("NOT_FOUND", "Sprint not found");
  return s;
}

/** Totals for one sprint right now. */
async function sprintTotals(conn: DbOrTx, sprint: Sprint) {
  const done = await doneColumnId(conn, sprint.organizationId, sprint.projectId);
  const [row] = await conn
    .select({
      scopePoints: sql<number>`coalesce(sum(${tasks.storyPoints}), 0)::int`,
      scopeTasks: sql<number>`count(*)::int`,
      completedPoints: sql<number>`coalesce(sum(${tasks.storyPoints}) filter (where ${tasks.columnId} = ${done}), 0)::int`,
      completedTasks: sql<number>`(count(*) filter (where ${tasks.columnId} = ${done}))::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.organizationId, sprint.organizationId), eq(tasks.sprintId, sprint.id)));
  return row ?? { scopePoints: 0, scopeTasks: 0, completedPoints: 0, completedTasks: 0 };
}

/**
 * Upsert today's snapshot for each given sprint that is active. Called inside the
 * same transaction as the task change, so charts can never drift from the data.
 */
export async function recordSprintSnapshots(conn: DbOrTx, organizationId: string, sprintIds: (string | null | undefined)[]) {
  const ids = [...new Set(sprintIds.filter(Boolean) as string[])];
  if (!ids.length) return;
  const active = await conn
    .select()
    .from(sprints)
    .where(and(eq(sprints.organizationId, organizationId), inArray(sprints.id, ids), eq(sprints.status, "active")));
  for (const s of active) {
    const totals = await sprintTotals(conn, s);
    await conn
      .insert(sprintSnapshots)
      .values({ organizationId, sprintId: s.id, day: utcToday(), ...totals })
      .onConflictDoUpdate({ target: [sprintSnapshots.sprintId, sprintSnapshots.day], set: totals });
  }
}

/** Validate a sprint a task may be put in: same tenant + project, not completed. */
export async function assertAssignableSprint(conn: DbOrTx, organizationId: string, projectId: string, sprintId: string) {
  const s = await sprintInOrg(conn, organizationId, sprintId);
  if (s.projectId !== projectId) throw new AppError("VALIDATION", "That sprint belongs to another project");
  if (s.status === "completed") throw new AppError("VALIDATION", "Tasks can't be added to a completed sprint");
  return s;
}

/* --------------------------------- reads --------------------------------- */

export type SprintDTO = {
  id: string;
  projectId: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
  status: Sprint["status"];
  committedPoints: number | null;
  completedPoints: number | null;
};

const toDTO = (s: Sprint): SprintDTO => ({
  id: s.id,
  projectId: s.projectId,
  name: s.name,
  goal: s.goal,
  startDate: s.startDate,
  endDate: s.endDate,
  status: s.status,
  committedPoints: s.committedPoints,
  completedPoints: s.completedPoints,
});

export async function listSprints(conn: DB, actorId: string, organizationId: string, projectId: string): Promise<SprintDTO[]> {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const rows = await conn
    .select()
    .from(sprints)
    .where(and(eq(sprints.organizationId, organizationId), eq(sprints.projectId, projectId)))
    .orderBy(asc(sprints.createdAt));
  // Active first, then planned in creation order, then completed (most recent first).
  const rank = { active: 0, planned: 1, completed: 2 } as const;
  return rows
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.status === "completed" ? +(b.completedAt ?? 0) - +(a.completedAt ?? 0) : 0))
    .map(toDTO);
}

export type SprintReport = {
  sprint: SprintDTO;
  days: { day: string; scopePoints: number; completedPoints: number; remainingPoints: number; ideal: number | null; future: boolean }[];
};

/** Daily series for burndown / burnup: gaps are carried forward, the future is left empty. */
export async function getSprintReport(conn: DB, actorId: string, organizationId: string, sprintId: string): Promise<SprintReport> {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const s = await sprintInOrg(conn, organizationId, sprintId);
  if (!s.startDate || !s.endDate) return { sprint: toDTO(s), days: [] };

  const snaps = await conn
    .select()
    .from(sprintSnapshots)
    .where(and(eq(sprintSnapshots.organizationId, organizationId), eq(sprintSnapshots.sprintId, s.id)))
    .orderBy(asc(sprintSnapshots.day));
  const byDay = new Map(snaps.map((x) => [x.day, x]));

  const total = Math.round((Date.parse(`${s.endDate}T00:00:00Z`) - Date.parse(`${s.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  const today = utcToday();
  const committed = s.committedPoints ?? snaps[0]?.scopePoints ?? 0;
  const days: SprintReport["days"] = [];
  let last = snaps.find((x) => x.day <= s.startDate!) ?? null;
  for (let i = 0; i < total; i++) {
    const day = addDaysIso(s.startDate, i);
    const future = s.status !== "completed" && day > today;
    if (byDay.has(day)) last = byDay.get(day)!;
    const scope = last?.scopePoints ?? committed;
    const completed = last?.completedPoints ?? 0;
    days.push({
      day,
      scopePoints: future ? 0 : scope,
      completedPoints: future ? 0 : completed,
      remainingPoints: future ? 0 : scope - completed,
      // Straight line from the commitment down to zero on the last day.
      ideal: total > 1 ? Math.round((committed * (1 - i / (total - 1))) * 10) / 10 : 0,
      future,
    });
  }
  return { sprint: toDTO(s), days };
}

/** Committed vs completed points for the most recent completed sprints (oldest → newest). */
export async function getVelocity(conn: DB, actorId: string, organizationId: string, projectId: string, limit = 8) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const rows = await conn
    .select({ id: sprints.id, name: sprints.name, committed: sprints.committedPoints, completed: sprints.completedPoints, completedAt: sprints.completedAt })
    .from(sprints)
    .where(and(eq(sprints.organizationId, organizationId), eq(sprints.projectId, projectId), eq(sprints.status, "completed")))
    .orderBy(desc(sprints.completedAt))
    .limit(Math.min(limit, 20));
  return rows.reverse().map((r) => ({ id: r.id, name: r.name, committed: r.committed ?? 0, completed: r.completed ?? 0 }));
}

/* -------------------------------- lifecycle -------------------------------- */

const sprintFields = z
  .object({
    name: z.string().trim().min(1).max(80),
    goal: z.string().trim().max(500).nullable(),
    startDate: dateStr.nullable(),
    endDate: dateStr.nullable(),
  })
  .partial();

function assertOrder(start: string | null | undefined, end: string | null | undefined) {
  if (start && end && start > end) throw new AppError("VALIDATION", "The sprint must end on or after its start date");
}

async function audit(conn: DbOrTx, organizationId: string, actorId: string, action: string, sprintId: string, metadata: Record<string, unknown>) {
  await conn.insert(auditLogs).values({ organizationId, actorId, action, entityType: "sprint", entityId: sprintId, metadata });
}

export async function createSprint(conn: DB, actorId: string, organizationId: string, projectId: string, raw: z.input<typeof sprintFields> = {}) {
  const input = sprintFields.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1);
    if (!project) throw new AppError("NOT_FOUND", "Project not found");

    const existing = await tx
      .select({ endDate: sprints.endDate })
      .from(sprints)
      .where(and(eq(sprints.organizationId, organizationId), eq(sprints.projectId, projectId)));
    // Defaults: "Sprint N", two weeks starting the day after the latest sprint ends (or today).
    const latestEnd = existing.map((e) => e.endDate).filter(Boolean).sort().pop() ?? null;
    const start = input.startDate ?? (latestEnd && latestEnd >= utcToday() ? addDaysIso(latestEnd, 1) : utcToday());
    const end = input.endDate ?? addDaysIso(start, 13);
    assertOrder(start, end);

    const [s] = await tx
      .insert(sprints)
      .values({ organizationId, projectId, name: input.name ?? `Sprint ${existing.length + 1}`, goal: input.goal ?? null, startDate: start, endDate: end })
      .returning();
    await audit(tx, organizationId, actorId, "SPRINT_CREATED", s!.id, { name: s!.name, startDate: start, endDate: end });
    return toDTO(s!);
  });
}

export async function updateSprint(conn: DB, actorId: string, organizationId: string, sprintId: string, raw: z.input<typeof sprintFields>) {
  const patch = sprintFields.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const s = await sprintInOrg(tx, organizationId, sprintId);
    if (s.status === "completed") throw new AppError("VALIDATION", "Completed sprints can't be edited");
    if (s.status === "active" && (patch.startDate === null || patch.endDate === null)) {
      throw new AppError("VALIDATION", "An active sprint needs start and end dates");
    }
    assertOrder(patch.startDate !== undefined ? patch.startDate : s.startDate, patch.endDate !== undefined ? patch.endDate : s.endDate);
    const [u] = await tx.update(sprints).set(patch).where(eq(sprints.id, sprintId)).returning();
    await audit(tx, organizationId, actorId, "SPRINT_UPDATED", sprintId, { changes: Object.keys(patch) });
    return toDTO(u!);
  });
}

export async function startSprint(conn: DB, actorId: string, organizationId: string, sprintId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const s = await sprintInOrg(tx, organizationId, sprintId);
    if (s.status !== "planned") throw new AppError("VALIDATION", "Only a planned sprint can be started");
    if (!s.startDate || !s.endDate) throw new AppError("VALIDATION", "Set start and end dates before starting the sprint");
    const [active] = await tx
      .select({ id: sprints.id, name: sprints.name })
      .from(sprints)
      .where(and(eq(sprints.projectId, s.projectId), eq(sprints.status, "active")))
      .limit(1);
    if (active) throw new AppError("CONFLICT", `Complete "${active.name}" before starting another sprint`);

    const totals = await sprintTotals(tx, s);
    // Starting early pulls the sprint to today and keeps its planned length.
    const today = utcToday();
    let { startDate, endDate } = s;
    if (startDate > today) {
      const len = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
      startDate = today;
      endDate = addDaysIso(today, len);
    }
    const [u] = await tx
      .update(sprints)
      .set({ status: "active", startedAt: new Date(), committedPoints: totals.scopePoints, startDate, endDate })
      .where(eq(sprints.id, sprintId))
      .returning();
    await recordSprintSnapshots(tx, organizationId, [sprintId]);
    await audit(tx, organizationId, actorId, "SPRINT_STARTED", sprintId, { name: s.name, committedPoints: totals.scopePoints, tasks: totals.scopeTasks });
    return toDTO(u!);
  });
}

/**
 * Complete the active sprint. Unfinished tasks move to the backlog or to another
 * planned/active-able sprint of the same project. Task versions are bumped so
 * open clients and stale edits stay consistent.
 */
export async function completeSprint(
  conn: DB,
  actorId: string,
  organizationId: string,
  sprintId: string,
  opts: { moveOpenTo: "backlog" | string } = { moveOpenTo: "backlog" }
) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const s = await sprintInOrg(tx, organizationId, sprintId);
    if (s.status !== "active") throw new AppError("VALIDATION", "Only the active sprint can be completed");
    let target: string | null = null;
    if (opts.moveOpenTo !== "backlog") {
      if (opts.moveOpenTo === sprintId) throw new AppError("VALIDATION", "Pick a different sprint for unfinished work");
      const t = await assertAssignableSprint(tx, organizationId, s.projectId, opts.moveOpenTo);
      target = t.id;
    }

    await recordSprintSnapshots(tx, organizationId, [sprintId]); // final day
    const totals = await sprintTotals(tx, s);
    const done = await doneColumnId(tx, organizationId, s.projectId);
    const moved = await tx
      .update(tasks)
      .set({ sprintId: target, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.sprintId, sprintId), done ? ne(tasks.columnId, done) : sql`true`))
      .returning();

    const [u] = await tx
      .update(sprints)
      .set({ status: "completed", completedAt: new Date(), completedPoints: totals.completedPoints })
      .where(eq(sprints.id, sprintId))
      .returning();
    await audit(tx, organizationId, actorId, "SPRINT_COMPLETED", sprintId, {
      name: s.name,
      committedPoints: s.committedPoints,
      completedPoints: totals.completedPoints,
      carriedOver: moved.length,
      movedTo: target ?? "backlog",
    });
    return { sprint: toDTO(u!), movedTasks: moved };
  });
}

/** Delete a planned sprint; its tasks return to the backlog (FK set null). */
export async function deleteSprint(conn: DB, actorId: string, organizationId: string, sprintId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const s = await sprintInOrg(tx, organizationId, sprintId);
    if (s.status !== "planned") throw new AppError("VALIDATION", "Only planned sprints can be deleted");
    const freed = await tx
      .update(tasks)
      .set({ sprintId: null, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.sprintId, sprintId)))
      .returning();
    await tx.delete(sprints).where(eq(sprints.id, sprintId));
    await audit(tx, organizationId, actorId, "SPRINT_DELETED", sprintId, { name: s.name, returnedToBacklog: freed.length });
    return { projectId: s.projectId, freedTasks: freed };
  });
}

/** Backlog = open tasks with no sprint (used by tests and the sprint view's counts). */
export async function backlogCount(conn: DB, organizationId: string, projectId: string) {
  const done = await doneColumnId(conn, organizationId, projectId);
  const [row] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.organizationId, organizationId), eq(tasks.projectId, projectId), isNull(tasks.sprintId), done ? ne(tasks.columnId, done) : sql`true`));
  return row?.n ?? 0;
}
