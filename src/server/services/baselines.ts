import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, baselineTasks, baselines, projects, tasks, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Gantt baselines: freeze every task's start/due dates under a name ("Plan v1",
 * "After scope change"), then compare the live timeline against it to see slippage.
 * Admins save and delete baselines; anyone in the workspace can view them.
 */

export const MAX_BASELINES = 10;

async function projectInOrg(conn: DB, organizationId: string, projectId: string) {
  const [p] = await conn.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
}

export async function createBaseline(conn: DB, actorId: string, organizationId: string, projectId: string, rawName: string) {
  const name = z.string().trim().min(1, "Name the baseline").max(80).parse(rawName);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  await projectInOrg(conn, organizationId, projectId);
  return conn.transaction(async (tx) => {
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(baselines).where(eq(baselines.projectId, projectId))) as [{ n: number }];
    if (n >= MAX_BASELINES) throw new AppError("VALIDATION", `A project keeps up to ${MAX_BASELINES} baselines. Delete an old one first.`);
    const [b] = await tx.insert(baselines).values({ organizationId, projectId, name, createdById: actorId }).returning();
    const rows = await tx
      .select({ id: tasks.id, startDate: tasks.startDate, dueDate: tasks.dueDate })
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.projectId, projectId)));
    const dated = rows.filter((r) => r.startDate || r.dueDate);
    for (let i = 0; i < dated.length; i += 500) {
      await tx.insert(baselineTasks).values(dated.slice(i, i + 500).map((r) => ({ baselineId: b!.id, taskId: r.id, startDate: r.startDate, dueDate: r.dueDate })));
    }
    await tx.insert(auditLogs).values({ organizationId, actorId, action: "BASELINE_SAVED", entityType: "project", entityId: projectId, metadata: { name, tasks: dated.length } });
    return { id: b!.id, name, createdAt: b!.createdAt, tasks: dated.length };
  });
}

export async function listBaselines(conn: DB, actorId: string, organizationId: string, projectId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  await projectInOrg(conn, organizationId, projectId);
  return conn
    .select({ id: baselines.id, name: baselines.name, createdAt: baselines.createdAt, createdByName: users.name })
    .from(baselines)
    .leftJoin(users, eq(users.id, baselines.createdById))
    .where(and(eq(baselines.organizationId, organizationId), eq(baselines.projectId, projectId)))
    .orderBy(desc(baselines.createdAt));
}

/** Dates per task in a baseline, plus a per-task slip (days the due date moved, positive = later). */
export async function getBaseline(conn: DB, actorId: string, organizationId: string, baselineId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const [b] = await conn.select().from(baselines).where(and(eq(baselines.id, baselineId), eq(baselines.organizationId, organizationId))).limit(1);
  if (!b) throw new AppError("NOT_FOUND", "Baseline not found");
  const rows = await conn
    .select({ taskId: baselineTasks.taskId, startDate: baselineTasks.startDate, dueDate: baselineTasks.dueDate, nowDue: tasks.dueDate })
    .from(baselineTasks)
    .innerJoin(tasks, eq(tasks.id, baselineTasks.taskId))
    .where(eq(baselineTasks.baselineId, baselineId))
    .orderBy(asc(baselineTasks.taskId));
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  return {
    id: b.id,
    name: b.name,
    createdAt: b.createdAt,
    tasks: rows.map((r) => ({
      taskId: r.taskId,
      startDate: r.startDate,
      dueDate: r.dueDate,
      slipDays: r.dueDate && r.nowDue ? Math.round(day(r.nowDue) - day(r.dueDate)) : null,
    })),
  };
}

export async function deleteBaseline(conn: DB, actorId: string, organizationId: string, baselineId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [b] = await conn.delete(baselines).where(and(eq(baselines.id, baselineId), eq(baselines.organizationId, organizationId))).returning({ name: baselines.name, projectId: baselines.projectId });
  if (!b) throw new AppError("NOT_FOUND", "Baseline not found");
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "BASELINE_DELETED", entityType: "project", entityId: b.projectId, metadata: { name: b.name } });
}
