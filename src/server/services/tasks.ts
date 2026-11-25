import { and, asc, eq, gt, lt, desc, sql, ne } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import {
  auditLogs,
  boardColumns,
  orgMembers,
  projects,
  taskComments,
  tasks,
  users,
  type Task,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { MIN_GAP, POSITION_STEP, rebalancePositions } from "@/lib/fractional-index";
import { requireOrgPermission } from "@/lib/rbac";

export const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);

/** Calendar date "YYYY-MM-DD" (date-only; validated as a real date). */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d);
  }, "Invalid date");
export const pointsSchema = z.number().int().min(0).max(100);

function assertDateOrder(start: string | null | undefined, due: string | null | undefined) {
  if (start && due && start > due) throw new AppError("VALIDATION", "Start date must be on or before the due date");
}

/* ------------------------------- helpers -------------------------------- */

async function assertColumnInOrg(conn: DbOrTx, organizationId: string, columnId: string) {
  const [col] = await conn
    .select({ id: boardColumns.id, projectId: boardColumns.projectId })
    .from(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.organizationId, organizationId)))
    .limit(1);
  // A column id from another tenant is indistinguishable from a missing one.
  if (!col) throw new AppError("NOT_FOUND", "Column not found");
  return col;
}

async function assertAssigneeInOrg(conn: DbOrTx, organizationId: string, assigneeId: string | null | undefined) {
  if (!assigneeId) return;
  const [m] = await conn
    .select({ id: orgMembers.id })
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, assigneeId)))
    .limit(1);
  if (!m) throw new AppError("VALIDATION", "Assignee is not a member of this workspace");
}

/** Renumber a column (1024, 2048, …) when midpoints run out of float precision. */
export async function rebalanceColumn(conn: DbOrTx, organizationId: string, columnId: string) {
  const rows = await conn
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.organizationId, organizationId), eq(tasks.columnId, columnId)))
    .orderBy(asc(tasks.position), asc(tasks.createdAt));
  const positions = rebalancePositions(rows.map((r) => r.id));
  for (const [id, position] of positions) {
    await conn.update(tasks).set({ position }).where(eq(tasks.id, id));
  }
  return Object.fromEntries(positions);
}

/** True if any neighbour of `position` within the column is closer than MIN_GAP. */
async function gapTooSmall(conn: DbOrTx, columnId: string, taskId: string, position: number) {
  const [prev] = await conn
    .select({ p: tasks.position })
    .from(tasks)
    .where(and(eq(tasks.columnId, columnId), ne(tasks.id, taskId), lt(tasks.position, position + MIN_GAP)))
    .orderBy(desc(tasks.position))
    .limit(1);
  const [next] = await conn
    .select({ p: tasks.position })
    .from(tasks)
    .where(and(eq(tasks.columnId, columnId), ne(tasks.id, taskId), gt(tasks.position, position - MIN_GAP)))
    .orderBy(asc(tasks.position))
    .limit(1);
  return (
    (prev && Math.abs(position - prev.p) < MIN_GAP) ||
    (next && Math.abs(next.p - position) < MIN_GAP) ||
    position < MIN_GAP
  );
}

/* -------------------------------- create -------------------------------- */

export const createTaskInput = z.object({
  organizationId: z.string().uuid(),
  columnId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).nullish(),
  priority: prioritySchema.default("medium"),
  assigneeId: z.string().uuid().nullish(),
  startDate: dateSchema.nullish(),
  dueDate: dateSchema.nullish(),
  storyPoints: pointsSchema.nullish(),
  parentId: z.string().uuid().nullish(),
});

export async function createTask(conn: DB, actorId: string, raw: z.input<typeof createTaskInput>) {
  const input = createTaskInput.parse(raw);
  await requireOrgPermission(actorId, input.organizationId, "member", conn);
  assertDateOrder(input.startDate, input.dueDate);

  return conn.transaction(async (tx) => {
    const col = await assertColumnInOrg(tx, input.organizationId, input.columnId);
    if (input.parentId) {
      const [parent] = await tx
        .select({ projectId: tasks.projectId, parentId: tasks.parentId })
        .from(tasks)
        .where(and(eq(tasks.id, input.parentId), eq(tasks.organizationId, input.organizationId)))
        .limit(1);
      // Another tenant's id looks exactly like a missing one.
      if (!parent) throw new AppError("NOT_FOUND", "Parent task not found");
      if (parent.parentId) throw new AppError("VALIDATION", "Subtasks can't have their own subtasks");
      if (parent.projectId !== col.projectId) throw new AppError("VALIDATION", "A subtask must be in the same project as its parent");
    }
    await assertAssigneeInOrg(tx, input.organizationId, input.assigneeId);

    // Atomic counter → ENG-1, ENG-2… without a MAX()+1 race.
    const [project] = await tx
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + 1` })
      .where(and(eq(projects.id, col.projectId), eq(projects.organizationId, input.organizationId)))
      .returning({ taskCounter: projects.taskCounter, key: projects.key });
    if (!project) throw new AppError("NOT_FOUND", "Project not found");

    const [last] = await tx
      .select({ position: tasks.position })
      .from(tasks)
      .where(eq(tasks.columnId, input.columnId))
      .orderBy(desc(tasks.position))
      .limit(1);

    const [task] = await tx
      .insert(tasks)
      .values({
        organizationId: input.organizationId,
        projectId: col.projectId,
        columnId: input.columnId,
        taskNumber: project.taskCounter,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        assigneeId: input.assigneeId ?? null,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        storyPoints: input.storyPoints ?? null,
        parentId: input.parentId ?? null,
        position: (last?.position ?? 0) + POSITION_STEP,
      })
      .returning();

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorId,
      action: "TASK_CREATED",
      entityType: "task",
      entityId: task!.id,
      metadata: { ref: `${project.key}-${task!.taskNumber}`, title: task!.title, columnId: input.columnId, parentId: input.parentId ?? null },
    });
    return task!;
  });
}

/* --------------------------------- move --------------------------------- */

export const moveTaskInput = z.object({
  organizationId: z.string().uuid(),
  taskId: z.string().uuid(),
  targetColumnId: z.string().uuid(),
  newPosition: z.number().finite().positive(),
  expectedVersion: z.number().int().positive(),
});

export type ConflictResult = { ok: false; code: "VERSION_CONFLICT"; current: Task | null };
export type MoveResult =
  | { ok: true; task: Task; rebalanced: Record<string, number> | null }
  | ConflictResult;

/**
 * Optimistic concurrency control: the UPDATE only matches when the row is still
 * at `expectedVersion`. Version bump + audit row commit atomically or not at all.
 */
export async function moveTask(conn: DB, actorId: string, raw: z.input<typeof moveTaskInput>): Promise<MoveResult> {
  const input = moveTaskInput.parse(raw);
  await requireOrgPermission(actorId, input.organizationId, "member", conn);

  return conn.transaction(async (tx) => {
    const targetCol = await assertColumnInOrg(tx, input.organizationId, input.targetColumnId);

    const [before] = await tx
      .select({ columnId: tasks.columnId, projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.organizationId, input.organizationId)))
      .limit(1);
    if (!before) throw new AppError("NOT_FOUND", "Task not found");
    if (before.projectId !== targetCol.projectId) {
      throw new AppError("VALIDATION", "Cannot move a task to another project's board");
    }

    const [updated] = await tx
      .update(tasks)
      .set({
        columnId: input.targetColumnId,
        position: input.newPosition,
        version: sql`${tasks.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.id, input.taskId),
          eq(tasks.organizationId, input.organizationId),
          eq(tasks.version, input.expectedVersion)
        )
      )
      .returning();

    if (!updated) {
      const [current] = await tx.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
      return { ok: false as const, code: "VERSION_CONFLICT" as const, current: current ?? null };
    }

    let rebalanced: Record<string, number> | null = null;
    let finalTask = updated;
    if (await gapTooSmall(tx, input.targetColumnId, updated.id, updated.position)) {
      rebalanced = await rebalanceColumn(tx, input.organizationId, input.targetColumnId);
      finalTask = { ...updated, position: rebalanced[updated.id]! };
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorId,
      action: "TASK_MOVED",
      entityType: "task",
      entityId: updated.id,
      metadata: {
        fromColumnId: before.columnId,
        targetColumnId: input.targetColumnId,
        newPosition: finalTask.position,
        version: updated.version,
        rebalanced: !!rebalanced,
      },
    });

    return { ok: true as const, task: finalTask, rebalanced };
  });
}

/* --------------------------------- edit --------------------------------- */

export const updateTaskInput = z.object({
  organizationId: z.string().uuid(),
  taskId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  patch: z
    .object({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(10_000).nullable(),
      priority: prioritySchema,
      assigneeId: z.string().uuid().nullable(),
      startDate: dateSchema.nullable(),
      dueDate: dateSchema.nullable(),
      storyPoints: pointsSchema.nullable(),
    })
    .partial(),
});

export type UpdateResult = { ok: true; task: Task; changes: string[] } | ConflictResult;

export async function updateTask(conn: DB, actorId: string, raw: z.input<typeof updateTaskInput>): Promise<UpdateResult> {
  const input = updateTaskInput.parse(raw);
  await requireOrgPermission(actorId, input.organizationId, "member", conn);

  return conn.transaction(async (tx) => {
    await assertAssigneeInOrg(tx, input.organizationId, input.patch.assigneeId);

    const [before] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.organizationId, input.organizationId)))
      .limit(1);
    if (!before) throw new AppError("NOT_FOUND", "Task not found");
    // Validate the merged result, so editing only the due date can't put it before an existing start.
    assertDateOrder(
      input.patch.startDate !== undefined ? input.patch.startDate : before.startDate,
      input.patch.dueDate !== undefined ? input.patch.dueDate : before.dueDate
    );

    const [updated] = await tx
      .update(tasks)
      .set({ ...input.patch, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(tasks.id, input.taskId),
          eq(tasks.organizationId, input.organizationId),
          eq(tasks.version, input.expectedVersion)
        )
      )
      .returning();

    if (!updated) return { ok: false as const, code: "VERSION_CONFLICT" as const, current: before };

    // `before` is exact here: the version matched, so nothing changed in between.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(input.patch) as (keyof typeof input.patch)[]) {
      if (before[key] !== updated[key]) changes[key] = { from: before[key], to: updated[key] };
    }

    await tx.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorId,
      action: "TASK_UPDATED",
      entityType: "task",
      entityId: updated.id,
      metadata: { changes, version: updated.version },
    });
    return { ok: true as const, task: updated, changes: Object.keys(changes) };
  });
}

/* -------------------------------- delete -------------------------------- */

export async function deleteTask(conn: DB, actorId: string, organizationId: string, taskId: string) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
      .returning();
    if (!deleted) throw new AppError("NOT_FOUND", "Task not found");
    await tx.insert(auditLogs).values({
      organizationId,
      actorId,
      action: "TASK_DELETED",
      entityType: "task",
      entityId: deleted.id,
      metadata: { title: deleted.title, taskNumber: deleted.taskNumber },
    });
    return deleted;
  });
}

/* ------------------------------- comments ------------------------------- */

export async function addComment(conn: DB, actorId: string, organizationId: string, taskId: string, body: string) {
  const text = z.string().trim().min(1).max(5_000).parse(body);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [task] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
      .limit(1);
    if (!task) throw new AppError("NOT_FOUND", "Task not found");
    const [comment] = await tx
      .insert(taskComments)
      .values({ organizationId, taskId, authorId: actorId, body: text })
      .returning();
    await tx.insert(auditLogs).values({
      organizationId,
      actorId,
      action: "COMMENT_ADDED",
      entityType: "task",
      entityId: taskId,
      metadata: { commentId: comment!.id, preview: text.slice(0, 120) },
    });
    return comment!;
  });
}

export async function listComments(conn: DB, actorId: string, organizationId: string, taskId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn
    .select({
      id: taskComments.id,
      body: taskComments.body,
      createdAt: taskComments.createdAt,
      authorName: users.name,
      authorId: taskComments.authorId,
    })
    .from(taskComments)
    .leftJoin(users, eq(users.id, taskComments.authorId))
    .where(and(eq(taskComments.organizationId, organizationId), eq(taskComments.taskId, taskId)))
    .orderBy(asc(taskComments.createdAt));
}
