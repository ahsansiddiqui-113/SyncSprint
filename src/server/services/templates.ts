import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import {
  auditLogs, boardColumns, checklistItems, customFields, projectTemplates, projects, tags, taskTags, taskTemplates, tasks,
  type ProjectTemplatePayload, type Task, type TaskTemplatePayload,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { isAdminRole } from "@/lib/rbac-shared";
import { BUILTIN_TEMPLATES, builtinTemplate } from "@/lib/project-templates";
import { TAG_COLORS } from "@/lib/tag-colors";
import { createProject } from "./workspace";
import { createTask } from "./tasks";
import { createField } from "./customize";
import { newEffects, type Effects } from "./task-effects";

/**
 * Templates:
 *  - project templates: built-in ones plus the workspace's own ("save this project as a template")
 *  - task templates: per project, e.g. "Bug report" or "Release checklist", with checklist, tags and subtasks
 */

const POSITION_STEP = 1024;
const MAX_TEMPLATE_TASKS = 200;

/* ------------------------------ project templates ------------------------------ */

export async function listProjectTemplates(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const custom = await conn
    .select({ id: projectTemplates.id, name: projectTemplates.name, description: projectTemplates.description, payload: projectTemplates.payload, createdAt: projectTemplates.createdAt })
    .from(projectTemplates)
    .where(eq(projectTemplates.organizationId, organizationId))
    .orderBy(desc(projectTemplates.createdAt));
  const summary = (p: ProjectTemplatePayload) => ({ statuses: p.columns.map((c) => c.title), fields: p.fields.length, tasks: p.tasks.length });
  return [
    ...BUILTIN_TEMPLATES.map((t) => ({ id: `builtin:${t.id}`, name: t.name, description: t.description, icon: t.icon, builtin: true, ...summary(t.payload) })),
    ...custom.map((t) => ({ id: t.id, name: t.name, description: t.description ?? "", icon: "📁", builtin: false, ...summary(t.payload) })),
  ];
}

async function templatePayload(conn: DB, organizationId: string, id: string): Promise<ProjectTemplatePayload> {
  if (id.startsWith("builtin:")) {
    const t = builtinTemplate(id.slice(8));
    if (!t) throw new AppError("NOT_FOUND", "Template not found");
    return t.payload;
  }
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND", "Template not found");
  const [t] = await conn.select().from(projectTemplates).where(and(eq(projectTemplates.id, id), eq(projectTemplates.organizationId, organizationId))).limit(1);
  if (!t) throw new AppError("NOT_FOUND", "Template not found");
  return t.payload;
}

/** Find tags by name (case-insensitive) or create them; returns name(lowercase) → id. */
async function ensureTags(conn: DB, organizationId: string, wanted: { name: string; color?: string }[]) {
  const map = new Map<string, string>();
  if (!wanted.length) return map;
  const existing = await conn.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.organizationId, organizationId));
  for (const e of existing) map.set(e.name.toLowerCase(), e.id);
  for (const [i, w] of wanted.entries()) {
    const key = w.name.trim().toLowerCase();
    if (!key || map.has(key)) continue;
    const color = (TAG_COLORS as readonly string[]).includes(w.color ?? "") ? w.color! : TAG_COLORS[i % TAG_COLORS.length]!;
    const [t] = await conn.insert(tags).values({ organizationId, name: w.name.trim().slice(0, 40), color }).onConflictDoNothing().returning({ id: tags.id });
    if (t) map.set(key, t.id);
  }
  return map;
}

/** Set up statuses, fields, tags and starter tasks in a brand-new (empty) project. */
export async function applyProjectTemplate(conn: DB, actorId: string, organizationId: string, projectId: string, payload: ProjectTemplatePayload, fx: Effects = newEffects()) {
  const [{ n }] = (await conn.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.projectId, projectId))) as [{ n: number }];
  if (n > 0) throw new AppError("CONFLICT", "Templates can only be applied to an empty project");
  if (payload.columns.length < 2) throw new AppError("VALIDATION", "A template needs at least two statuses");

  await conn.delete(boardColumns).where(eq(boardColumns.projectId, projectId));
  const cols = await conn
    .insert(boardColumns)
    .values(payload.columns.slice(0, 12).map((c, i) => ({ organizationId, projectId, title: c.title.slice(0, 80), color: c.color, wipLimit: c.wipLimit ?? null, position: (i + 1) * POSITION_STEP })))
    .returning();
  for (const f of payload.fields.slice(0, 20)) {
    await createField(conn, actorId, organizationId, projectId, {
      name: f.name,
      type: f.type,
      options: (f.options ?? []).map((label, i) => ({ label, color: TAG_COLORS[i % TAG_COLORS.length]! })),
    });
  }
  const tagIds = await ensureTags(conn, organizationId, [...payload.tags, ...payload.tasks.flatMap((t) => (t.tags ?? []).map((name) => ({ name })))]);
  for (const t of payload.tasks.slice(0, MAX_TEMPLATE_TASKS)) {
    const col = cols[Math.min(Math.max(0, t.column), cols.length - 1)]!;
    const task = await createTask(conn, actorId, {
      organizationId, columnId: col.id, title: t.title, description: t.description ?? null, type: t.type ?? "task",
      priority: t.priority ?? "medium", storyPoints: t.storyPoints ?? null, estimateHours: t.estimateHours ?? null,
    }, fx);
    await decorate(conn, organizationId, task.id, (t.tags ?? []).map((name) => tagIds.get(name.toLowerCase())).filter((x): x is string => !!x), t.checklist ?? []);
    for (const s of (t.subtasks ?? []).slice(0, 30)) {
      await createTask(conn, actorId, { organizationId, columnId: col.id, title: s, parentId: task.id, type: "task" }, fx);
    }
  }
}

async function decorate(conn: DB, organizationId: string, taskId: string, tagIds: string[], checklist: string[]) {
  if (tagIds.length) await conn.insert(taskTags).values(tagIds.map((tagId) => ({ taskId, tagId, organizationId }))).onConflictDoNothing();
  if (checklist.length) {
    await conn.insert(checklistItems).values(checklist.slice(0, 50).map((text, i) => ({ organizationId, taskId, text: text.slice(0, 300), position: (i + 1) * POSITION_STEP })));
  }
}

export async function createProjectFromTemplate(
  conn: DB, actorId: string,
  raw: { organizationId: string; name: string; key: string; description?: string; templateId?: string | null },
  fx: Effects = newEffects(),
) {
  const payload = raw.templateId ? await templatePayload(conn, raw.organizationId, raw.templateId) : null;
  const project = await createProject(conn, actorId, { organizationId: raw.organizationId, name: raw.name, key: raw.key, description: raw.description });
  if (payload) {
    try {
      await applyProjectTemplate(conn, actorId, raw.organizationId, project.id, payload, fx);
    } catch (err) {
      // Leave no half-built project behind.
      await conn.delete(projects).where(eq(projects.id, project.id));
      throw err;
    }
  }
  return project;
}

export async function saveProjectAsTemplate(conn: DB, actorId: string, organizationId: string, projectId: string, raw: { name: string; description?: string | null; includeTasks: boolean }) {
  const input = z.object({ name: z.string().trim().min(1, "Name the template").max(80), description: z.string().trim().max(300).nullish(), includeTasks: z.boolean() }).parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [p] = await conn.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
  const cols = await conn.select().from(boardColumns).where(eq(boardColumns.projectId, projectId)).orderBy(asc(boardColumns.position));
  const fields = await conn.select().from(customFields).where(eq(customFields.projectId, projectId)).orderBy(asc(customFields.position));
  const payload: ProjectTemplatePayload = {
    columns: cols.map((c) => ({ title: c.title, color: c.color, wipLimit: c.wipLimit })),
    fields: fields.map((f) => ({ name: f.name, type: f.type, options: f.options.map((o) => o.label) })),
    tags: [],
    tasks: [],
  };
  if (input.includeTasks) {
    const top = await conn.select().from(tasks).where(and(eq(tasks.projectId, projectId), isNull(tasks.parentId))).orderBy(asc(tasks.position)).limit(MAX_TEMPLATE_TASKS);
    const ids = top.map((t) => t.id);
    const subs = ids.length ? await conn.select({ parentId: tasks.parentId, title: tasks.title }).from(tasks).where(inArray(tasks.parentId, ids)).orderBy(asc(tasks.taskNumber)) : [];
    const checks = ids.length ? await conn.select({ taskId: checklistItems.taskId, text: checklistItems.text }).from(checklistItems).where(inArray(checklistItems.taskId, ids)).orderBy(asc(checklistItems.position)) : [];
    const tagRows = ids.length ? await conn.select({ taskId: taskTags.taskId, name: tags.name, color: tags.color }).from(taskTags).innerJoin(tags, eq(tags.id, taskTags.tagId)).where(inArray(taskTags.taskId, ids)) : [];
    payload.tags = [...new Map(tagRows.map((t) => [t.name.toLowerCase(), { name: t.name, color: t.color }])).values()];
    payload.tasks = top.map((t) => ({
      title: t.title, description: t.description, type: t.type, priority: t.priority,
      column: Math.max(0, cols.findIndex((c) => c.id === t.columnId)),
      storyPoints: t.storyPoints, estimateHours: t.estimateHours,
      tags: tagRows.filter((r) => r.taskId === t.id).map((r) => r.name),
      checklist: checks.filter((c) => c.taskId === t.id).map((c) => c.text),
      subtasks: subs.filter((s) => s.parentId === t.id).map((s) => s.title),
    }));
  }
  const [t] = await conn.insert(projectTemplates).values({ organizationId, name: input.name, description: input.description ?? null, payload, createdById: actorId }).returning({ id: projectTemplates.id });
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "TEMPLATE_SAVED", entityType: "project", entityId: projectId, metadata: { name: input.name, tasks: payload.tasks.length } });
  return { id: t!.id };
}

export async function deleteProjectTemplate(conn: DB, actorId: string, organizationId: string, templateId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const gone = await conn.delete(projectTemplates).where(and(eq(projectTemplates.id, templateId), eq(projectTemplates.organizationId, organizationId))).returning({ id: projectTemplates.id });
  if (!gone.length) throw new AppError("NOT_FOUND", "Template not found");
}

/* -------------------------------- task templates -------------------------------- */

export async function listTaskTemplates(conn: DB, actorId: string, organizationId: string, projectId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn
    .select({ id: taskTemplates.id, name: taskTemplates.name, payload: taskTemplates.payload, createdById: taskTemplates.createdById })
    .from(taskTemplates)
    .where(and(eq(taskTemplates.organizationId, organizationId), eq(taskTemplates.projectId, projectId)))
    .orderBy(asc(taskTemplates.name));
}

export async function saveTaskTemplate(conn: DB, actorId: string, organizationId: string, taskId: string, rawName: string) {
  const name = z.string().trim().min(1, "Name the template").max(80).parse(rawName);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const [t] = await conn.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId))).limit(1);
  if (!t) throw new AppError("NOT_FOUND", "Task not found");
  const [{ n }] = (await conn.select({ n: sql<number>`count(*)::int` }).from(taskTemplates).where(eq(taskTemplates.projectId, t.projectId))) as [{ n: number }];
  if (n >= 50) throw new AppError("VALIDATION", "A project can have up to 50 task templates");
  const subs = await conn.select({ title: tasks.title }).from(tasks).where(eq(tasks.parentId, t.id)).orderBy(asc(tasks.taskNumber));
  const checks = await conn.select({ text: checklistItems.text }).from(checklistItems).where(eq(checklistItems.taskId, t.id)).orderBy(asc(checklistItems.position));
  const tagRows = await conn.select({ tagId: taskTags.tagId }).from(taskTags).where(eq(taskTags.taskId, t.id));
  const payload: TaskTemplatePayload = {
    title: t.title, description: t.description, type: t.type, priority: t.priority, storyPoints: t.storyPoints, estimateHours: t.estimateHours,
    tagIds: tagRows.map((r) => r.tagId), checklist: checks.map((c) => c.text), subtasks: subs.map((s) => s.title),
  };
  const [tpl] = await conn.insert(taskTemplates).values({ organizationId, projectId: t.projectId, name, payload, createdById: actorId }).returning({ id: taskTemplates.id });
  return { id: tpl!.id };
}

/** New task (with its checklist, tags and subtasks) from a template; first status unless one is given. */
export async function createTaskFromTemplate(conn: DB, actorId: string, organizationId: string, templateId: string, columnId?: string | null, fx: Effects = newEffects()) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const [tpl] = await conn.select().from(taskTemplates).where(and(eq(taskTemplates.id, templateId), eq(taskTemplates.organizationId, organizationId))).limit(1);
  if (!tpl) throw new AppError("NOT_FOUND", "Template not found");
  const cols = await conn.select({ id: boardColumns.id }).from(boardColumns).where(eq(boardColumns.projectId, tpl.projectId)).orderBy(asc(boardColumns.position));
  const col = columnId && cols.some((c) => c.id === columnId) ? columnId : cols[0]?.id;
  if (!col) throw new AppError("VALIDATION", "This project has no statuses");
  const p = tpl.payload;
  const task = await createTask(conn, actorId, { organizationId, columnId: col, title: p.title, description: p.description, type: p.type, priority: p.priority, storyPoints: p.storyPoints, estimateHours: p.estimateHours }, fx);
  // Only tags that still exist in this workspace.
  const live = p.tagIds.length ? (await conn.select({ id: tags.id }).from(tags).where(and(eq(tags.organizationId, organizationId), inArray(tags.id, p.tagIds)))).map((t) => t.id) : [];
  await decorate(conn, organizationId, task.id, live, p.checklist);
  const created: Task[] = [task];
  for (const s of p.subtasks.slice(0, 30)) created.push(await createTask(conn, actorId, { organizationId, columnId: col, title: s, parentId: task.id }, fx));
  return { task, created };
}

export async function deleteTaskTemplate(conn: DB, actorId: string, organizationId: string, templateId: string) {
  const role = await requireOrgPermission(actorId, organizationId, "member", conn);
  const [tpl] = await conn.select().from(taskTemplates).where(and(eq(taskTemplates.id, templateId), eq(taskTemplates.organizationId, organizationId))).limit(1);
  if (!tpl) throw new AppError("NOT_FOUND", "Template not found");
  if (tpl.createdById !== actorId && !isAdminRole(role)) throw new AppError("FORBIDDEN", "Only its creator or an admin can delete this template");
  await conn.delete(taskTemplates).where(eq(taskTemplates.id, templateId));
}
