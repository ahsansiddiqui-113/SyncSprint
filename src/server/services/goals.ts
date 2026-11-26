import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, boardColumns, goals, keyResultTasks, keyResults, orgMembers, projects, tasks, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { POSITION_STEP } from "@/lib/fractional-index";

/**
 * Goals (OKRs). A goal has key results of two kinds:
 *  - number: progress = (current - start) / (target - start), clamped 0..1
 *  - tasks:  progress = linked tasks in their project's Done column / linked tasks
 * Goal progress is the average of its key results. Admins manage goals;
 * members update numeric progress and link work.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function numberProgress(start: number, target: number, current: number) {
  if (target === start) return current >= target ? 1 : 0;
  return Math.max(0, Math.min(1, (current - start) / (target - start)));
}

export type KeyResultView = {
  id: string;
  title: string;
  kind: "number" | "tasks";
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string | null;
  progress: number;
  done: number;
  total: number;
  tasks: { id: string; ref: string; title: string; done: boolean }[];
};

export async function listGoals(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const goalRows = await conn
    .select({ goal: goals, ownerName: users.name })
    .from(goals)
    .leftJoin(users, eq(users.id, goals.ownerId))
    .where(eq(goals.organizationId, organizationId))
    .orderBy(asc(goals.dueDate), asc(goals.createdAt));
  const krs = await conn.select().from(keyResults).where(eq(keyResults.organizationId, organizationId)).orderBy(asc(keyResults.position));

  // Linked tasks with "done" = sitting in the last (highest-position) column of their project.
  const lastCol = conn
    .select({ projectId: boardColumns.projectId, pos: max(boardColumns.position).as("pos") })
    .from(boardColumns)
    .where(eq(boardColumns.organizationId, organizationId))
    .groupBy(boardColumns.projectId)
    .as("last_col");
  const links = krs.length
    ? await conn
        .select({
          keyResultId: keyResultTasks.keyResultId,
          id: tasks.id,
          title: tasks.title,
          taskNumber: tasks.taskNumber,
          key: projects.key,
          done: sql<boolean>`${boardColumns.position} = ${lastCol.pos}`,
        })
        .from(keyResultTasks)
        .innerJoin(tasks, eq(tasks.id, keyResultTasks.taskId))
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
        .innerJoin(lastCol, eq(lastCol.projectId, tasks.projectId))
        .where(and(eq(keyResultTasks.organizationId, organizationId), inArray(keyResultTasks.keyResultId, krs.map((k) => k.id))))
    : [];

  return goalRows.map(({ goal, ownerName }) => {
    const items: KeyResultView[] = krs
      .filter((k) => k.goalId === goal.id)
      .map((k) => {
        const linked = links.filter((l) => l.keyResultId === k.id);
        const done = linked.filter((l) => l.done).length;
        const progress = k.kind === "tasks" ? (linked.length ? done / linked.length : 0) : numberProgress(k.startValue, k.targetValue, k.currentValue);
        return {
          id: k.id, title: k.title, kind: k.kind, startValue: k.startValue, targetValue: k.targetValue, currentValue: k.currentValue,
          unit: k.unit, progress, done, total: linked.length,
          tasks: linked.map((l) => ({ id: l.id, ref: `${l.key}-${l.taskNumber}`, title: l.title, done: !!l.done })),
        };
      });
    const progress = items.length ? items.reduce((s, k) => s + k.progress, 0) / items.length : 0;
    return { id: goal.id, title: goal.title, description: goal.description, ownerId: goal.ownerId, ownerName, dueDate: goal.dueDate, progress, keyResults: items };
  });
}

async function assertOwnerIsMember(conn: DB, organizationId: string, ownerId: string | null | undefined) {
  if (!ownerId) return;
  const [m] = await conn.select({ id: orgMembers.userId }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, ownerId))).limit(1);
  if (!m) throw new AppError("VALIDATION", "The owner must be a workspace member");
}

const goalSchema = z.object({
  title: z.string().trim().min(1, "Give the goal a title").max(160),
  description: z.string().trim().max(2000).nullish(),
  ownerId: z.string().uuid().nullish(),
  dueDate: z.string().regex(DATE).nullish(),
});

export async function createGoal(conn: DB, actorId: string, organizationId: string, raw: z.input<typeof goalSchema>) {
  const input = goalSchema.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  await assertOwnerIsMember(conn, organizationId, input.ownerId);
  const [g] = await conn
    .insert(goals)
    .values({ organizationId, title: input.title, description: input.description ?? null, ownerId: input.ownerId ?? actorId, dueDate: input.dueDate ?? null })
    .returning();
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "GOAL_CREATED", entityType: "goal", entityId: g!.id, metadata: { title: input.title } });
  return g!;
}

export async function updateGoal(conn: DB, actorId: string, organizationId: string, goalId: string, raw: Partial<z.input<typeof goalSchema>>) {
  const input = goalSchema.partial().parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  await assertOwnerIsMember(conn, organizationId, input.ownerId);
  const [g] = await conn
    .update(goals)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId ?? null } : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate ?? null } : {}),
    })
    .where(and(eq(goals.id, goalId), eq(goals.organizationId, organizationId)))
    .returning();
  if (!g) throw new AppError("NOT_FOUND", "Goal not found");
  return g;
}

export async function deleteGoal(conn: DB, actorId: string, organizationId: string, goalId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [g] = await conn.delete(goals).where(and(eq(goals.id, goalId), eq(goals.organizationId, organizationId))).returning({ title: goals.title });
  if (!g) throw new AppError("NOT_FOUND", "Goal not found");
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "GOAL_DELETED", entityType: "goal", entityId: goalId, metadata: { title: g.title } });
}

const krSchema = z
  .object({
    title: z.string().trim().min(1, "Give the key result a title").max(160),
    kind: z.enum(["number", "tasks"]),
    startValue: z.number().finite().default(0),
    targetValue: z.number().finite().default(100),
    currentValue: z.number().finite().optional(),
    unit: z.string().trim().max(20).nullish(),
  })
  .refine((k) => k.kind === "tasks" || k.targetValue !== k.startValue, { message: "Target must differ from the starting value" });

export async function addKeyResult(conn: DB, actorId: string, organizationId: string, goalId: string, raw: z.input<typeof krSchema>) {
  const input = krSchema.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [g] = await conn.select({ id: goals.id }).from(goals).where(and(eq(goals.id, goalId), eq(goals.organizationId, organizationId))).limit(1);
  if (!g) throw new AppError("NOT_FOUND", "Goal not found");
  const [{ top }] = (await conn
    .select({ top: sql<number>`coalesce(max(${keyResults.position}), 0)` })
    .from(keyResults)
    .where(eq(keyResults.goalId, goalId))) as [{ top: number }];
  const [kr] = await conn
    .insert(keyResults)
    .values({
      organizationId, goalId, title: input.title, kind: input.kind,
      startValue: input.kind === "tasks" ? 0 : input.startValue,
      targetValue: input.kind === "tasks" ? 100 : input.targetValue,
      currentValue: input.kind === "tasks" ? 0 : (input.currentValue ?? input.startValue),
      unit: input.kind === "tasks" ? null : (input.unit ?? null),
      position: Number(top) + POSITION_STEP,
    })
    .returning();
  return kr!;
}

/** Members can update a numeric key result's current value (the weekly check-in). */
export async function updateKeyResultValue(conn: DB, actorId: string, organizationId: string, keyResultId: string, currentValue: number) {
  const value = z.number().finite().parse(currentValue);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const [kr] = await conn
    .update(keyResults)
    .set({ currentValue: value })
    .where(and(eq(keyResults.id, keyResultId), eq(keyResults.organizationId, organizationId), eq(keyResults.kind, "number")))
    .returning();
  if (!kr) throw new AppError("NOT_FOUND", "Key result not found");
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "KEY_RESULT_UPDATED", entityType: "key_result", entityId: keyResultId, metadata: { currentValue: value } });
  return kr;
}

export async function deleteKeyResult(conn: DB, actorId: string, organizationId: string, keyResultId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [kr] = await conn.delete(keyResults).where(and(eq(keyResults.id, keyResultId), eq(keyResults.organizationId, organizationId))).returning({ id: keyResults.id });
  if (!kr) throw new AppError("NOT_FOUND", "Key result not found");
}

export async function setKeyResultTaskLink(conn: DB, actorId: string, organizationId: string, keyResultId: string, taskId: string, linked: boolean) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const [kr] = await conn.select({ id: keyResults.id, kind: keyResults.kind }).from(keyResults).where(and(eq(keyResults.id, keyResultId), eq(keyResults.organizationId, organizationId))).limit(1);
  const [t] = await conn.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId))).limit(1);
  if (!kr || !t) throw new AppError("NOT_FOUND", "Key result or task not found");
  if (kr.kind !== "tasks") throw new AppError("VALIDATION", "Only task-based key results track linked work");
  if (linked) await conn.insert(keyResultTasks).values({ organizationId, keyResultId, taskId }).onConflictDoNothing();
  else await conn.delete(keyResultTasks).where(and(eq(keyResultTasks.keyResultId, keyResultId), eq(keyResultTasks.taskId, taskId)));
}
