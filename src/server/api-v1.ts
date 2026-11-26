import "server-only";
import { and, asc, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { boardColumns, projects, taskComments, tasks, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { requireOrgPermission } from "@/lib/rbac";
import { POSITION_STEP } from "@/lib/fractional-index";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { publishEffects, publishTaskUpdate } from "@/server/after-task-change";
import { publishEvent, publishTask, toPublicTasks } from "@/server/public-events";
import { pingInboxes } from "@/server/inbox-broadcast";
import * as svc from "@/server/services/tasks";
import { newEffects } from "@/server/services/task-effects";
import { columnFor, projectByKey, resolveAssignee, taskByIdOrRef, type ApiContext } from "@/server/api-route";

/** /api/v1 operations. Each one goes through the same services (RBAC, OCC, audit, automations) as the app. */

export async function apiListProjects(ctx: ApiContext) {
  await requireOrgPermission(ctx.userId, ctx.organizationId, "viewer");
  const rows = await db
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
      description: projects.description,
      createdAt: projects.createdAt,
      taskCount: sql<number>`(select count(*)::int from ${tasks} where ${tasks.projectId} = "projects"."id")`,
    })
    .from(projects)
    .where(eq(projects.organizationId, ctx.organizationId))
    .orderBy(asc(projects.key));
  const cols = rows.length
    ? await db.select({ projectId: boardColumns.projectId, id: boardColumns.id, title: boardColumns.title }).from(boardColumns).where(inArray(boardColumns.projectId, rows.map((r) => r.id))).orderBy(asc(boardColumns.position))
    : [];
  return { data: rows.map((p) => ({ ...p, statuses: cols.filter((c) => c.projectId === p.id).map(({ id, title }) => ({ id, name: title })) })) };
}

const listQuery = z.object({
  status: z.string().max(60).optional(),
  assignee: z.string().max(200).optional(),
  updatedSince: z.string().datetime({ offset: true }).optional(),
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function apiListTasks(ctx: ApiContext, key: string, params: URLSearchParams) {
  await requireOrgPermission(ctx.userId, ctx.organizationId, "viewer");
  const q = listQuery.parse(Object.fromEntries(params));
  const project = await projectByKey(ctx.organizationId, key);
  const conds = [eq(tasks.organizationId, ctx.organizationId), eq(tasks.projectId, project.id)];
  if (q.status) conds.push(eq(tasks.columnId, (await columnFor(project.id, q.status)).id));
  if (q.assignee) {
    const id = await resolveAssignee(ctx.organizationId, q.assignee);
    if (id) conds.push(eq(tasks.assigneeId, id));
  }
  if (q.updatedSince) conds.push(gte(tasks.updatedAt, new Date(q.updatedSince)));
  if (q.after !== undefined) conds.push(gt(tasks.taskNumber, q.after));
  const rows = await db.select().from(tasks).where(and(...conds)).orderBy(asc(tasks.taskNumber)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  return {
    data: await toPublicTasks(db, ctx.organizationId, page),
    nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.taskNumber) : null,
  };
}

const fieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).nullable(),
  priority: svc.prioritySchema,
  type: svc.workItemTypeSchema,
  startDate: svc.dateSchema.nullable(),
  dueDate: svc.dateSchema.nullable(),
  storyPoints: svc.pointsSchema.nullable(),
  estimateHours: svc.estimateSchema.nullable(),
  status: z.string().min(1).max(60),
  assignee: z.string().max(200).nullable(),
  parentId: z.string().uuid().nullable(),
  sprintId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().positive(),
});

export async function apiCreateTask(ctx: ApiContext, key: string, body: Record<string, unknown>) {
  const input = fieldsSchema.omit({ expectedVersion: true }).partial().required({ title: true }).strict().parse(body);
  const project = await projectByKey(ctx.organizationId, key);
  const column = input.status
    ? await columnFor(project.id, input.status)
    : (await db.select({ id: boardColumns.id }).from(boardColumns).where(eq(boardColumns.projectId, project.id)).orderBy(asc(boardColumns.position)).limit(1))[0];
  if (!column) throw new AppError("VALIDATION", "This project has no statuses");
  const fx = newEffects();
  const task = await svc.createTask(
    db,
    ctx.userId,
    {
      organizationId: ctx.organizationId,
      columnId: column.id,
      title: input.title,
      description: input.description,
      priority: input.priority,
      type: input.type,
      startDate: input.startDate,
      dueDate: input.dueDate,
      storyPoints: input.storyPoints,
      estimateHours: input.estimateHours,
      parentId: input.parentId,
      sprintId: input.sprintId,
      assigneeId: await resolveAssignee(ctx.organizationId, input.assignee),
    },
    fx
  );
  broadcastOrgEvent(ctx.organizationId, { type: "TASK_CREATED", actor: ctx.actor, task: toTaskDTO(task) });
  publishTask(ctx.organizationId, "task.created", task, { via: "api" });
  publishEffects(ctx.organizationId, ctx.actor, task.projectId, fx);
  return new Response(JSON.stringify({ data: (await toPublicTasks(db, ctx.organizationId, [task]))[0] }), { status: 201, headers: { "Content-Type": "application/json" } });
}

export async function apiGetTask(ctx: ApiContext, idOrRef: string) {
  await requireOrgPermission(ctx.userId, ctx.organizationId, "viewer");
  const task = await taskByIdOrRef(ctx.organizationId, idOrRef);
  return { data: (await toPublicTasks(db, ctx.organizationId, [task]))[0] };
}

/**
 * Partial update. `status` moves the task (to the end of that status); other fields edit it.
 * Send `expectedVersion` to get 409 instead of overwriting a newer change; without it the
 * update applies to the latest version (last write wins).
 */
export async function apiUpdateTask(ctx: ApiContext, idOrRef: string, body: Record<string, unknown>) {
  const input = fieldsSchema.omit({ parentId: true }).partial().strict().parse(body);
  let task = await taskByIdOrRef(ctx.organizationId, idOrRef);
  if (input.expectedVersion !== undefined && input.expectedVersion !== task.version) {
    throw new AppError("VERSION_CONFLICT", `The task is at version ${task.version}; reload and retry.`);
  }
  const fx = newEffects();
  if (input.status) {
    const col = await columnFor(task.projectId, input.status);
    if (col.id !== task.columnId) {
      const [last] = await db.select({ position: tasks.position }).from(tasks).where(eq(tasks.columnId, col.id)).orderBy(desc(tasks.position)).limit(1);
      const res = await svc.moveTask(
        db,
        ctx.userId,
        { organizationId: ctx.organizationId, taskId: task.id, targetColumnId: col.id, newPosition: (last?.position ?? 0) + POSITION_STEP, expectedVersion: task.version },
        fx
      );
      if (!res.ok) throw new AppError("VERSION_CONFLICT", "The task changed while moving it; reload and retry.");
      task = res.task;
      broadcastOrgEvent(ctx.organizationId, { type: "TASK_UPDATED", actor: ctx.actor, task: toTaskDTO(task), action: "moved" });
    }
  }
  const { status: _s, expectedVersion: _v, assignee, ...rest } = input;
  const patch = { ...rest, ...(assignee !== undefined ? { assigneeId: await resolveAssignee(ctx.organizationId, assignee) } : {}) };
  const changes: string[] = input.status ? ["status"] : [];
  if (Object.keys(patch).length) {
    const res = await svc.updateTask(db, ctx.userId, { organizationId: ctx.organizationId, taskId: task.id, expectedVersion: task.version, patch }, fx);
    if (!res.ok) throw new AppError("VERSION_CONFLICT", "The task changed while updating it; reload and retry.");
    task = res.task;
    changes.push(...res.changes);
    broadcastOrgEvent(ctx.organizationId, { type: "TASK_UPDATED", actor: ctx.actor, task: toTaskDTO(task), action: "edited", changes: res.changes });
  }
  if (changes.length) {
    publishTaskUpdate(ctx.organizationId, task, changes);
    publishEffects(ctx.organizationId, ctx.actor, task.projectId, fx);
  }
  return { data: (await toPublicTasks(db, ctx.organizationId, [task]))[0] };
}

export async function apiDeleteTask(ctx: ApiContext, idOrRef: string) {
  const task = await taskByIdOrRef(ctx.organizationId, idOrRef);
  const payload = (await toPublicTasks(db, ctx.organizationId, [task]))[0];
  const deleted = await svc.deleteTask(db, ctx.userId, ctx.organizationId, task.id);
  broadcastOrgEvent(ctx.organizationId, { type: "TASK_DELETED", actor: ctx.actor, taskId: task.id, projectId: deleted.projectId });
  publishEvent(ctx.organizationId, "task.deleted", async () => ({ task: payload, via: "api" }));
  return new Response(null, { status: 204 });
}

export async function apiListComments(ctx: ApiContext, idOrRef: string) {
  await requireOrgPermission(ctx.userId, ctx.organizationId, "viewer");
  const task = await taskByIdOrRef(ctx.organizationId, idOrRef);
  const rows = await db
    .select({ id: taskComments.id, body: taskComments.body, createdAt: taskComments.createdAt, authorId: taskComments.authorId, authorName: users.name })
    .from(taskComments)
    .leftJoin(users, eq(users.id, taskComments.authorId))
    .where(and(eq(taskComments.organizationId, ctx.organizationId), eq(taskComments.taskId, task.id)))
    .orderBy(asc(taskComments.createdAt))
    .limit(500);
  return { data: rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })) };
}

export async function apiAddComment(ctx: ApiContext, idOrRef: string, body: Record<string, unknown>) {
  const { body: text } = z.object({ body: z.string().trim().min(1).max(5000) }).strict().parse(body);
  const task = await taskByIdOrRef(ctx.organizationId, idOrRef);
  const c = await svc.addComment(db, ctx.userId, ctx.organizationId, task.id, text);
  broadcastOrgEvent(ctx.organizationId, { type: "COMMENT_ADDED", actor: ctx.actor, taskId: task.id, commentId: c.id });
  pingInboxes(ctx.organizationId, c.notified);
  const comment = { id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), author: { id: ctx.userId, name: ctx.userName } };
  publishEvent(ctx.organizationId, "comment.created", async () => ({ comment, task: (await toPublicTasks(db, ctx.organizationId, [task]))[0], via: "api" }));
  return new Response(JSON.stringify({ data: comment }), { status: 201, headers: { "Content-Type": "application/json" } });
}
