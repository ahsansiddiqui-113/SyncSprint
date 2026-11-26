import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import {
  auditLogs,
  boardColumns,
  customFields,
  orgMembers,
  savedViews,
  taskAssignees,
  taskFieldValues,
  taskWatchers,
  tasks,
  type SavedViewConfig,
  type SelectOption,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/fractional-index";
import { requireOrgPermission } from "@/lib/rbac";
import { notifyAssigned } from "./notifications";
import { TAG_COLORS } from "@/lib/tag-colors";
import { recordSprintSnapshots } from "./sprints";

/**
 * Phase 4 customization: custom statuses, custom fields, co-assignees, watchers
 * and saved views. Invariant for statuses: the LAST column of a project is
 * always "Done" — it can be renamed/recolored but not moved or deleted.
 */

const colorSchema = z.enum(TAG_COLORS);

async function audit(conn: DbOrTx, organizationId: string, actorId: string, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
  await conn.insert(auditLogs).values({ organizationId, actorId, action, entityType, entityId, metadata });
}

async function projectColumns(conn: DbOrTx, organizationId: string, projectId: string) {
  return conn
    .select()
    .from(boardColumns)
    .where(and(eq(boardColumns.organizationId, organizationId), eq(boardColumns.projectId, projectId)))
    .orderBy(asc(boardColumns.position));
}

async function columnInOrg(conn: DbOrTx, organizationId: string, columnId: string) {
  const [c] = await conn
    .select()
    .from(boardColumns)
    .where(and(eq(boardColumns.id, columnId), eq(boardColumns.organizationId, organizationId)))
    .limit(1);
  if (!c) throw new AppError("NOT_FOUND", "Status not found");
  return c;
}

async function taskInOrg(conn: DbOrTx, organizationId: string, taskId: string) {
  const [t] = await conn
    .select({ id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  if (!t) throw new AppError("NOT_FOUND", "Task not found");
  return t;
}

async function membersOf(conn: DbOrTx, organizationId: string, userIds: string[]) {
  if (!userIds.length) return new Set<string>();
  const rows = await conn
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, organizationId), inArray(orgMembers.userId, userIds)));
  return new Set(rows.map((r) => r.userId));
}

/* ------------------------------ custom statuses ----------------------------- */

const statusTitle = z.string().trim().min(1).max(40);

/** Add a status just before "Done" (the last column), like ClickUp. */
export async function addStatus(conn: DB, actorId: string, organizationId: string, projectId: string, raw: { title: string; color?: string | null }) {
  const title = statusTitle.parse(raw.title);
  const color = raw.color ? colorSchema.parse(raw.color) : null;
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const cols = await projectColumns(tx, organizationId, projectId);
    if (!cols.length) throw new AppError("NOT_FOUND", "Project not found");
    if (cols.some((c) => c.title.toLowerCase() === title.toLowerCase())) throw new AppError("CONFLICT", `A status named "${title}" already exists`);
    if (cols.length >= 12) throw new AppError("VALIDATION", "A project can have at most 12 statuses");
    const done = cols[cols.length - 1]!;
    const before = cols[cols.length - 2];
    const position = before ? (before.position + done.position) / 2 : done.position / 2;
    const [col] = await tx.insert(boardColumns).values({ organizationId, projectId, title, color, position }).returning();
    await audit(tx, organizationId, actorId, "STATUS_CREATED", "status", col!.id, { title });
    return col!;
  });
}

export async function updateStatus(conn: DB, actorId: string, organizationId: string, columnId: string, raw: { title?: string; color?: string | null }) {
  const patch: { title?: string; color?: string | null } = {};
  if (raw.title !== undefined) patch.title = statusTitle.parse(raw.title);
  if (raw.color !== undefined) patch.color = raw.color === null ? null : colorSchema.parse(raw.color);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const col = await columnInOrg(tx, organizationId, columnId);
    if (patch.title) {
      const cols = await projectColumns(tx, organizationId, col.projectId);
      if (cols.some((c) => c.id !== columnId && c.title.toLowerCase() === patch.title!.toLowerCase())) {
        throw new AppError("CONFLICT", `A status named "${patch.title}" already exists`);
      }
    }
    const [u] = await tx.update(boardColumns).set(patch).where(eq(boardColumns.id, columnId)).returning();
    await audit(tx, organizationId, actorId, "STATUS_UPDATED", "status", columnId, { from: col.title, ...patch });
    return u!;
  });
}

/** Move an open status one step left/right. "Done" stays last and can't be passed. */
export async function moveStatus(conn: DB, actorId: string, organizationId: string, columnId: string, dir: "left" | "right") {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const col = await columnInOrg(tx, organizationId, columnId);
    const cols = await projectColumns(tx, organizationId, col.projectId);
    const i = cols.findIndex((c) => c.id === columnId);
    const lastOpen = cols.length - 2;
    if (i === cols.length - 1) throw new AppError("VALIDATION", "The Done status always stays last");
    const j = dir === "left" ? i - 1 : i + 1;
    if (j < 0 || j > lastOpen) throw new AppError("VALIDATION", "This status can't move further");
    const other = cols[j]!;
    // Swap positions: two rows, no renumbering.
    await tx.update(boardColumns).set({ position: other.position }).where(eq(boardColumns.id, col.id));
    await tx.update(boardColumns).set({ position: col.position }).where(eq(boardColumns.id, other.id));
    await audit(tx, organizationId, actorId, "STATUS_MOVED", "status", columnId, { title: col.title, dir });
    return { projectId: col.projectId };
  });
}

/** Delete an open status; its tasks move (to the end of) another status. */
export async function deleteStatus(conn: DB, actorId: string, organizationId: string, columnId: string, moveTo: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const col = await columnInOrg(tx, organizationId, columnId);
    const cols = await projectColumns(tx, organizationId, col.projectId);
    if (cols[cols.length - 1]!.id === columnId) throw new AppError("VALIDATION", "The Done status can't be deleted");
    if (cols.length <= 2) throw new AppError("VALIDATION", "A project needs at least one open status and Done");
    const target = cols.find((c) => c.id === moveTo);
    if (!target || target.id === columnId) throw new AppError("VALIDATION", "Choose another status for its tasks");

    const [last] = await tx
      .select({ p: tasks.position })
      .from(tasks)
      .where(eq(tasks.columnId, target.id))
      .orderBy(desc(tasks.position))
      .limit(1);
    const moving = await tx.select().from(tasks).where(eq(tasks.columnId, columnId)).orderBy(asc(tasks.position));
    const moved = [];
    let pos = last?.p ?? 0;
    for (const t of moving) {
      pos += POSITION_STEP;
      const [u] = await tx
        .update(tasks)
        .set({ columnId: target.id, position: pos, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
        .where(eq(tasks.id, t.id))
        .returning();
      moved.push(u!);
    }
    await tx.delete(boardColumns).where(eq(boardColumns.id, columnId));
    // Moving into Done changes sprint progress.
    await recordSprintSnapshots(tx, organizationId, moved.map((t) => t.sprintId));
    await audit(tx, organizationId, actorId, "STATUS_DELETED", "status", columnId, { title: col.title, movedTo: target.title, moved: moved.length });
    return { projectId: col.projectId, moved };
  });
}

/* ------------------------------- custom fields ------------------------------ */

export const fieldTypeSchema = z.enum(["text", "number", "select", "date", "person"]);
const optionInput = z.object({ id: z.string().uuid().optional(), label: z.string().trim().min(1).max(40), color: colorSchema });

function normalizeOptions(raw: z.infer<typeof optionInput>[]): SelectOption[] {
  const seen = new Set<string>();
  return raw.map((o) => {
    const key = o.label.toLowerCase();
    if (seen.has(key)) throw new AppError("VALIDATION", `Duplicate option "${o.label}"`);
    seen.add(key);
    return { id: o.id ?? randomUUID(), label: o.label, color: o.color };
  });
}

export async function createField(
  conn: DB,
  actorId: string,
  organizationId: string,
  projectId: string,
  raw: { name: string; type: string; options?: { id?: string; label: string; color: string }[] }
) {
  const input = z
    .object({ name: z.string().trim().min(1).max(60), type: fieldTypeSchema, options: z.array(optionInput).max(30).default([]) })
    .parse(raw);
  if (input.type === "select" && input.options.length === 0) throw new AppError("VALIDATION", "A dropdown needs at least one option");
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const cols = await projectColumns(tx, organizationId, projectId);
    if (!cols.length) throw new AppError("NOT_FOUND", "Project not found");
    const existing = await tx.select().from(customFields).where(and(eq(customFields.organizationId, organizationId), eq(customFields.projectId, projectId)));
    if (existing.some((f) => f.name.toLowerCase() === input.name.toLowerCase())) throw new AppError("CONFLICT", `A field named "${input.name}" already exists`);
    if (existing.length >= 20) throw new AppError("VALIDATION", "A project can have at most 20 custom fields");
    const [f] = await tx
      .insert(customFields)
      .values({
        organizationId,
        projectId,
        name: input.name,
        type: input.type,
        options: input.type === "select" ? normalizeOptions(input.options) : [],
        position: (existing.reduce((m, x) => Math.max(m, x.position), 0) || 0) + POSITION_STEP,
      })
      .returning();
    await audit(tx, organizationId, actorId, "FIELD_CREATED", "field", f!.id, { name: input.name, type: input.type });
    return f!;
  });
}

export async function updateField(conn: DB, actorId: string, organizationId: string, fieldId: string, raw: { name?: string; options?: { id?: string; label: string; color: string }[] }) {
  const input = z.object({ name: z.string().trim().min(1).max(60).optional(), options: z.array(optionInput).max(30).optional() }).parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const [f] = await tx.select().from(customFields).where(and(eq(customFields.id, fieldId), eq(customFields.organizationId, organizationId))).limit(1);
    if (!f) throw new AppError("NOT_FOUND", "Field not found");
    const patch: Partial<typeof customFields.$inferInsert> = {};
    if (input.name) patch.name = input.name;
    if (input.options) {
      if (f.type !== "select") throw new AppError("VALIDATION", "Only dropdown fields have options");
      if (!input.options.length) throw new AppError("VALIDATION", "A dropdown needs at least one option");
      patch.options = normalizeOptions(input.options);
      // Values pointing at removed options are cleared, so no task shows a ghost option.
      const keep = new Set(patch.options.map((o) => o.id));
      const values = await tx.select().from(taskFieldValues).where(eq(taskFieldValues.fieldId, fieldId));
      const stale = values.filter((v) => !keep.has(String(v.value))).map((v) => v.taskId);
      if (stale.length) await tx.delete(taskFieldValues).where(and(eq(taskFieldValues.fieldId, fieldId), inArray(taskFieldValues.taskId, stale)));
    }
    const [u] = await tx.update(customFields).set(patch).where(eq(customFields.id, fieldId)).returning();
    await audit(tx, organizationId, actorId, "FIELD_UPDATED", "field", fieldId, { name: u!.name });
    return u!;
  });
}

export async function deleteField(conn: DB, actorId: string, organizationId: string, fieldId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const [f] = await tx.delete(customFields).where(and(eq(customFields.id, fieldId), eq(customFields.organizationId, organizationId))).returning();
    if (!f) throw new AppError("NOT_FOUND", "Field not found");
    await audit(tx, organizationId, actorId, "FIELD_DELETED", "field", fieldId, { name: f.name });
    return f;
  });
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/** Set (or clear with null) a task's value for a custom field; validated by field type. */
export async function setFieldValue(conn: DB, actorId: string, organizationId: string, taskId: string, fieldId: string, raw: unknown) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const task = await taskInOrg(tx, organizationId, taskId);
    const [f] = await tx.select().from(customFields).where(and(eq(customFields.id, fieldId), eq(customFields.organizationId, organizationId))).limit(1);
    if (!f) throw new AppError("NOT_FOUND", "Field not found");
    if (f.projectId !== task.projectId) throw new AppError("VALIDATION", "That field belongs to another project");

    let value: string | number | null = null;
    if (raw !== null && raw !== "" && raw !== undefined) {
      switch (f.type) {
        case "text":
          value = z.string().trim().max(500).parse(raw);
          break;
        case "number":
          value = z.number().finite().min(-1e12).max(1e12).parse(raw);
          break;
        case "select":
          value = z.string().parse(raw);
          if (!f.options.some((o) => o.id === value)) throw new AppError("VALIDATION", "That option doesn't exist");
          break;
        case "date": {
          const d = z.string().regex(dateRe).parse(raw);
          const t = new Date(`${d}T00:00:00Z`);
          if (Number.isNaN(t.getTime()) || !t.toISOString().startsWith(d)) throw new AppError("VALIDATION", "Invalid date");
          value = d;
          break;
        }
        case "person":
          value = z.string().uuid().parse(raw);
          if (!(await membersOf(tx, organizationId, [value])).size) throw new AppError("VALIDATION", "That person isn't in this workspace");
          break;
      }
    }

    if (value === null || value === "") {
      await tx.delete(taskFieldValues).where(and(eq(taskFieldValues.taskId, taskId), eq(taskFieldValues.fieldId, fieldId)));
    } else {
      await tx
        .insert(taskFieldValues)
        .values({ organizationId, taskId, fieldId, value })
        .onConflictDoUpdate({ target: [taskFieldValues.taskId, taskFieldValues.fieldId], set: { value } });
    }
    await audit(tx, organizationId, actorId, "FIELD_VALUE_SET", "task", taskId, { field: f.name, cleared: value === null });
    return { projectId: task.projectId };
  });
}

/* ---------------------------- assignees & watchers --------------------------- */

/** Replace a task's co-assignees (the primary assignee is tasks.assignee_id). */
export async function setCoAssignees(conn: DB, actorId: string, organizationId: string, taskId: string, rawIds: string[]) {
  const ids = [...new Set(z.array(z.string().uuid()).max(20).parse(rawIds))];
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const task = await taskInOrg(tx, organizationId, taskId);
    const wanted = ids.filter((id) => id !== task.assigneeId);
    const valid = await membersOf(tx, organizationId, wanted);
    if (valid.size !== wanted.length) throw new AppError("VALIDATION", "Everyone assigned must be in this workspace");
    const previous = new Set((await tx.select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, taskId))).map((r) => r.userId));
    await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
    if (wanted.length) await tx.insert(taskAssignees).values(wanted.map((userId) => ({ organizationId, taskId, userId })));
    await audit(tx, organizationId, actorId, "ASSIGNEES_UPDATED", "task", taskId, { coAssignees: wanted.length });
    const notified = await notifyAssigned(tx, organizationId, actorId, taskId, wanted.filter((u) => !previous.has(u)));
    return { projectId: task.projectId, coAssignees: wanted, notified };
  });
}

/** Watch / unwatch a task. Any member — including viewers — can watch for themselves. */
export async function setWatching(conn: DB, actorId: string, organizationId: string, taskId: string, on: boolean) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn.transaction(async (tx) => {
    const task = await taskInOrg(tx, organizationId, taskId);
    if (on) await tx.insert(taskWatchers).values({ organizationId, taskId, userId: actorId }).onConflictDoNothing();
    else await tx.delete(taskWatchers).where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, actorId)));
    return { projectId: task.projectId };
  });
}

/* ------------------------------- saved views ------------------------------- */

const viewConfig = z.object({
  view: z.enum(["board", "list", "table", "sprints", "calendar", "timeline", "dashboard", "workload"]),
  filters: z.record(z.string(), z.unknown()),
  sort: z.object({ key: z.string().max(60), dir: z.enum(["asc", "desc"]) }).nullish(),
  groupBy: z.string().max(60).nullish(),
});

export async function listSavedViews(conn: DB, actorId: string, organizationId: string, projectId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const rows = await conn
    .select()
    .from(savedViews)
    .where(and(eq(savedViews.organizationId, organizationId), eq(savedViews.projectId, projectId)))
    .orderBy(asc(savedViews.createdAt));
  return rows.filter((v) => v.ownerId === actorId || v.shared);
}

export async function saveView(conn: DB, actorId: string, organizationId: string, projectId: string, raw: { name: string; config: SavedViewConfig; shared?: boolean }) {
  const name = z.string().trim().min(1).max(60).parse(raw.name);
  const config = viewConfig.parse(raw.config) as SavedViewConfig;
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  // Sharing a view with the whole project is a member capability.
  if (raw.shared) await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const cols = await projectColumns(tx, organizationId, projectId);
    if (!cols.length) throw new AppError("NOT_FOUND", "Project not found");
    const [v] = await tx.insert(savedViews).values({ organizationId, projectId, ownerId: actorId, name, config, shared: !!raw.shared }).returning();
    return v!;
  });
}

export async function updateSavedView(conn: DB, actorId: string, organizationId: string, viewId: string, raw: { name?: string; config?: SavedViewConfig; shared?: boolean }) {
  const role = await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const [v] = await conn.select().from(savedViews).where(and(eq(savedViews.id, viewId), eq(savedViews.organizationId, organizationId))).limit(1);
  if (!v || (v.ownerId !== actorId && !v.shared)) throw new AppError("NOT_FOUND", "View not found");
  const isAdmin = role === "owner" || role === "admin";
  if (v.ownerId !== actorId && !isAdmin) throw new AppError("FORBIDDEN", "Only the person who created this view can change it");
  const patch: Partial<typeof savedViews.$inferInsert> = { updatedAt: new Date() };
  if (raw.name !== undefined) patch.name = z.string().trim().min(1).max(60).parse(raw.name);
  if (raw.config !== undefined) patch.config = viewConfig.parse(raw.config) as SavedViewConfig;
  if (raw.shared !== undefined) patch.shared = raw.shared;
  const [u] = await conn.update(savedViews).set(patch).where(eq(savedViews.id, viewId)).returning();
  return u!;
}

export async function deleteSavedView(conn: DB, actorId: string, organizationId: string, viewId: string) {
  const role = await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const [v] = await conn.select().from(savedViews).where(and(eq(savedViews.id, viewId), eq(savedViews.organizationId, organizationId))).limit(1);
  if (!v || (v.ownerId !== actorId && !v.shared)) throw new AppError("NOT_FOUND", "View not found");
  if (v.ownerId !== actorId && !(role === "owner" || role === "admin")) throw new AppError("FORBIDDEN", "Only the person who created this view can delete it");
  await conn.delete(savedViews).where(eq(savedViews.id, viewId));
  return { projectId: v.projectId };
}
