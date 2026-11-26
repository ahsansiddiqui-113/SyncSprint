import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  auditLogs,
  boardColumns,
  orgMembers,
  projects,
  sprints,
  tags,
  taskTags,
  tasks,
  users,
  type TaskPriority,
  type Task,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/fractional-index";
import { parseCsv, toCsv } from "@/lib/csv";
import { requireOrgPermission } from "@/lib/rbac";
import { TAG_COLORS } from "@/lib/tag-colors";

/**
 * CSV export and import. Import understands SyncSprint's own export and Jira's
 * "Export issues → CSV (all fields)" headers, maps statuses / priorities / types /
 * people by name, and always shows a preview with per-row warnings before creating
 * anything. Imports are one transaction: all rows or none.
 */

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

type Field = "key" | "title" | "description" | "status" | "priority" | "type" | "assignee" | "points" | "estimate" | "estimateSeconds" | "start" | "due" | "labels" | "parent";

const HEADERS: Record<string, Field> = {
  "issue key": "key", key: "key", ref: "key",
  summary: "title", title: "title", name: "title", task: "title", "task name": "title",
  description: "description",
  status: "status",
  priority: "priority",
  "issue type": "type", type: "type", "work item type": "type",
  assignee: "assignee", "assignee email": "assignee", "assigned to": "assignee", owner: "assignee",
  "story points": "points", points: "points", "custom field (story points)": "points", "custom field (story point estimate)": "points", "story point estimate": "points",
  "estimate (h)": "estimate", estimate: "estimate", "estimate hours": "estimate", "time estimate (h)": "estimate",
  "original estimate": "estimateSeconds", "time estimate": "estimateSeconds",
  "start date": "start", start: "start", "custom field (start date)": "start",
  "due date": "due", due: "due",
  labels: "labels", tags: "labels", label: "labels",
  parent: "parent", "parent key": "parent", "parent issue key": "parent",
};

const PRIORITY: Record<string, TaskPriority> = {
  highest: "urgent", blocker: "urgent", critical: "urgent", urgent: "urgent", p0: "urgent",
  high: "high", major: "high", p1: "high",
  medium: "medium", normal: "medium", p2: "medium",
  low: "low", lowest: "low", minor: "low", trivial: "low", p3: "low", p4: "low",
};
const TYPE: Record<string, Task["type"]> = {
  epic: "epic", story: "story", "user story": "story", feature: "story",
  bug: "bug", defect: "bug", task: "task", "sub-task": "task", subtask: "task", chore: "task",
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** ISO, Jira ("12/Mar/24 3:00 PM"), or "12 Mar 2024". Returns null if unreadable. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/ -]([A-Za-z]{3})[A-Za-z]*[/ -](\d{2,4})/.exec(s))) {
    d = Number(m[1]);
    mo = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    y = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]);
  } else return null;
  if (!mo || mo > 12 || d < 1) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || y < 1970 || y > 2100) return null;
  return date.toISOString().slice(0, 10);
}

export type ImportRow = {
  line: number;
  key: string | null;
  title: string;
  description: string | null;
  columnId: string;
  status: string;
  priority: TaskPriority;
  type: Task["type"];
  assigneeId: string | null;
  assigneeName: string | null;
  storyPoints: number | null;
  estimateHours: number | null;
  startDate: string | null;
  dueDate: string | null;
  labels: string[];
  parentKey: string | null;
  warnings: string[];
};

export type ImportPreview = {
  mapped: { header: string; field: Field | null }[];
  rows: ImportRow[];
  skipped: { line: number; reason: string }[];
  newLabels: string[];
};

async function buildPreview(conn: DB, organizationId: string, projectId: string, csv: string): Promise<ImportPreview> {
  if (csv.length > MAX_IMPORT_BYTES) throw new AppError("VALIDATION", "The file is larger than 2 MB");
  const table = parseCsv(csv, MAX_IMPORT_ROWS + 1);
  if (table.length < 2) throw new AppError("VALIDATION", "The file needs a header row and at least one task");
  if (table.length - 1 > MAX_IMPORT_ROWS) throw new AppError("VALIDATION", `Import up to ${MAX_IMPORT_ROWS} tasks at a time`);
  const header = table[0]!.map((h) => h.trim());
  const mapped = header.map((h) => ({ header: h, field: HEADERS[h.toLowerCase()] ?? null }));
  if (!mapped.some((m) => m.field === "title")) throw new AppError("VALIDATION", 'No "Summary" or "Title" column found');

  const [cols, members, orgTags] = await Promise.all([
    conn.select({ id: boardColumns.id, title: boardColumns.title }).from(boardColumns).where(eq(boardColumns.projectId, projectId)).orderBy(asc(boardColumns.position)),
    conn.select({ id: users.id, name: users.name, email: users.email }).from(orgMembers).innerJoin(users, eq(users.id, orgMembers.userId)).where(eq(orgMembers.organizationId, organizationId)),
    conn.select({ name: tags.name }).from(tags).where(eq(tags.organizationId, organizationId)),
  ]);
  if (!cols.length) throw new AppError("VALIDATION", "This project has no statuses");
  const first = cols[0]!;
  const last = cols[cols.length - 1]!;
  const statusFor = (raw: string): { col: typeof first; exact: boolean } => {
    const s = raw.trim().toLowerCase();
    const exact = cols.find((c) => c.title.toLowerCase() === s);
    if (exact) return { col: exact, exact: true };
    if (!s || ["to do", "todo", "open", "new", "backlog", "selected for development"].includes(s)) return { col: first, exact: true };
    if (["done", "closed", "resolved", "complete", "completed", "shipped"].includes(s)) return { col: last, exact: true };
    if (s.includes("progress") || s === "doing" || s === "active") return { col: cols.find((c) => /progress|doing/i.test(c.title)) ?? cols[Math.min(1, cols.length - 1)]!, exact: true };
    if (s.includes("review") || s === "qa" || s.includes("test")) return { col: cols.find((c) => /review|qa|test/i.test(c.title)) ?? first, exact: true };
    return { col: first, exact: false };
  };

  const rows: ImportRow[] = [];
  const skipped: ImportPreview["skipped"] = [];
  const labelSet = new Set<string>();
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    const get = (f: Field) => mapped.flatMap((m, idx) => (m.field === f ? [(cells[idx] ?? "").trim()] : [])).filter(Boolean);
    const one = (f: Field) => get(f)[0] ?? "";
    const title = one("title").slice(0, 200);
    if (!title) {
      skipped.push({ line: i + 1, reason: "No title" });
      continue;
    }
    const warnings: string[] = [];
    const statusRaw = one("status");
    const st = statusFor(statusRaw);
    if (!st.exact) warnings.push(`Status "${statusRaw}" → ${st.col.title}`);

    const prRaw = one("priority").toLowerCase();
    const priority = PRIORITY[prRaw] ?? "medium";
    if (prRaw && !PRIORITY[prRaw]) warnings.push(`Priority "${one("priority")}" → medium`);
    const tyRaw = one("type").toLowerCase();
    const type = TYPE[tyRaw] ?? "task";
    if (tyRaw && !TYPE[tyRaw]) warnings.push(`Type "${one("type")}" → task`);

    const who = one("assignee");
    const person = who ? members.find((m) => m.email.toLowerCase() === who.toLowerCase() || m.name.toLowerCase() === who.toLowerCase()) : undefined;
    if (who && !person) warnings.push(`"${who}" isn't in this workspace → unassigned`);

    const num = (s: string) => (s && Number.isFinite(Number(s)) ? Number(s) : null);
    let storyPoints = num(one("points"));
    if (storyPoints !== null) {
      const r = Math.round(storyPoints);
      if (r < 0 || r > 100) (warnings.push("Story points out of range → empty"), (storyPoints = null));
      else storyPoints = r;
    }
    let estimate = num(one("estimate"));
    const secs = num(one("estimateSeconds"));
    if (estimate === null && secs !== null) estimate = secs / 3600;
    if (estimate !== null) {
      const q = Math.round(estimate * 4) / 4;
      if (q <= 0 || q > 999) (warnings.push("Estimate out of range → empty"), (estimate = null));
      else estimate = q;
    }
    let startDate = one("start") ? parseDate(one("start")) : null;
    let dueDate = one("due") ? parseDate(one("due")) : null;
    if (one("start") && !startDate) warnings.push(`Couldn't read start date "${one("start")}"`);
    if (one("due") && !dueDate) warnings.push(`Couldn't read due date "${one("due")}"`);
    if (startDate && dueDate && startDate > dueDate) (warnings.push("Start was after due → start dropped"), (startDate = null));

    const labels = [...new Set(get("labels").flatMap((l) => l.split(/[;,]/)).map((l) => l.trim().slice(0, 40)).filter(Boolean))].slice(0, 10);
    labels.forEach((l) => labelSet.add(l));
    rows.push({
      line: i + 1,
      key: one("key") || null,
      title,
      description: one("description").slice(0, 10_000) || null,
      columnId: st.col.id,
      status: st.col.title,
      priority,
      type,
      assigneeId: person?.id ?? null,
      assigneeName: person?.name ?? null,
      storyPoints,
      estimateHours: estimate,
      startDate,
      dueDate,
      labels,
      parentKey: one("parent") || null,
      warnings,
    });
  }
  // Parents only resolve to tasks in this same file, one level deep.
  const byKey = new Map(rows.filter((r) => r.key).map((r) => [r.key!, r]));
  for (const r of rows) {
    if (!r.parentKey) continue;
    const parent = byKey.get(r.parentKey);
    if (!parent || parent === r) (r.warnings.push(`Parent ${r.parentKey} isn't in this file → no parent`), (r.parentKey = null));
    else if (parent.parentKey) (r.warnings.push(`Parent ${r.parentKey} is itself a subtask → no parent`), (r.parentKey = null));
  }
  const existing = new Set(orgTags.map((t) => t.name.toLowerCase()));
  return { mapped, rows, skipped, newLabels: [...labelSet].filter((l) => !existing.has(l.toLowerCase())) };
}

async function projectFor(conn: DB, organizationId: string, projectId: string) {
  const [p] = await conn.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
  return p;
}

export async function previewImport(conn: DB, actorId: string, organizationId: string, projectId: string, csv: string) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  await projectFor(conn, organizationId, projectId);
  return buildPreview(conn, organizationId, projectId, csv);
}

export async function commitImport(conn: DB, actorId: string, organizationId: string, projectId: string, csv: string) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const project = await projectFor(conn, organizationId, projectId);
  const preview = await buildPreview(conn, organizationId, projectId, csv);
  if (!preview.rows.length) throw new AppError("VALIDATION", "Nothing to import");
  return conn.transaction(async (tx) => {
    const [counter] = await tx
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + ${preview.rows.length}` })
      .where(eq(projects.id, project.id))
      .returning({ n: projects.taskCounter });
    let number = counter!.n - preview.rows.length;
    const tops = await tx
      .select({ columnId: tasks.columnId, top: sql<number>`max(${tasks.position})` })
      .from(tasks)
      .where(eq(tasks.projectId, project.id))
      .groupBy(tasks.columnId);
    const nextPos = new Map(tops.map((t) => [t.columnId, Number(t.top)]));
    const values = preview.rows.map((r) => {
      const pos = (nextPos.get(r.columnId) ?? 0) + POSITION_STEP;
      nextPos.set(r.columnId, pos);
      number += 1;
      return {
        organizationId, projectId: project.id, columnId: r.columnId, taskNumber: number, title: r.title, description: r.description,
        priority: r.priority, type: r.type, assigneeId: r.assigneeId, storyPoints: r.storyPoints, estimateHours: r.estimateHours,
        startDate: r.startDate, dueDate: r.dueDate, position: pos,
      };
    });
    const created: Task[] = [];
    for (let i = 0; i < values.length; i += 200) created.push(...(await tx.insert(tasks).values(values.slice(i, i + 200)).returning()));

    // Parents (same file), then labels.
    const keyToId = new Map(preview.rows.flatMap((r, i) => (r.key ? [[r.key, created[i]!.id] as const] : [])));
    for (const [i, r] of preview.rows.entries()) {
      if (r.parentKey && keyToId.has(r.parentKey)) await tx.update(tasks).set({ parentId: keyToId.get(r.parentKey)! }).where(eq(tasks.id, created[i]!.id));
    }
    const labelNames = [...new Set(preview.rows.flatMap((r) => r.labels))];
    if (labelNames.length) {
      const have = await tx.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.organizationId, organizationId));
      const byName = new Map(have.map((t) => [t.name.toLowerCase(), t.id]));
      const missing = labelNames.filter((n) => !byName.has(n.toLowerCase()));
      if (missing.length) {
        const made = await tx
          .insert(tags)
          .values(missing.map((name, i) => ({ organizationId, name, color: TAG_COLORS[(have.length + i) % TAG_COLORS.length]! })))
          .onConflictDoNothing()
          .returning({ id: tags.id, name: tags.name });
        made.forEach((t) => byName.set(t.name.toLowerCase(), t.id));
      }
      const links = preview.rows.flatMap((r, i) => r.labels.flatMap((l) => (byName.get(l.toLowerCase()) ? [{ organizationId, taskId: created[i]!.id, tagId: byName.get(l.toLowerCase())! }] : [])));
      for (let i = 0; i < links.length; i += 500) await tx.insert(taskTags).values(links.slice(i, i + 500)).onConflictDoNothing();
    }
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: "TASKS_IMPORTED", entityType: "project", entityId: project.id,
      metadata: { count: created.length, key: project.key, warnings: preview.rows.reduce((s, r) => s + r.warnings.length, 0) },
    });
    const final = await tx.select().from(tasks).where(inArray(tasks.id, created.map((t) => t.id)));
    return { created: final, skipped: preview.skipped.length };
  });
}

export async function exportProjectCsv(conn: DB, actorId: string, organizationId: string, projectId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const project = await projectFor(conn, organizationId, projectId);
  const rows = await conn
    .select({ task: tasks, status: boardColumns.title, assignee: users.name, email: users.email, sprint: sprints.name })
    .from(tasks)
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(sprints, eq(sprints.id, tasks.sprintId))
    .where(and(eq(tasks.organizationId, organizationId), eq(tasks.projectId, project.id)))
    .orderBy(asc(tasks.taskNumber));
  const ids = rows.map((r) => r.task.id);
  const labelRows = ids.length
    ? await conn.select({ taskId: taskTags.taskId, name: tags.name }).from(taskTags).innerJoin(tags, eq(tags.id, taskTags.tagId)).where(inArray(taskTags.taskId, ids))
    : [];
  const labels = new Map<string, string[]>();
  for (const l of labelRows) labels.set(l.taskId, [...(labels.get(l.taskId) ?? []), l.name]);
  const refOf = new Map(rows.map((r) => [r.task.id, `${project.key}-${r.task.taskNumber}`]));
  const csv = toCsv([
    ["Key", "Summary", "Status", "Priority", "Type", "Assignee", "Assignee Email", "Story Points", "Estimate (h)", "Start Date", "Due Date", "Sprint", "Labels", "Parent", "Created", "Updated", "Description"],
    ...rows.map((r) => [
      refOf.get(r.task.id)!, r.task.title, r.status, r.task.priority, r.task.type, r.assignee, r.email, r.task.storyPoints, r.task.estimateHours,
      r.task.startDate, r.task.dueDate, r.sprint, (labels.get(r.task.id) ?? []).join(";"), r.task.parentId ? (refOf.get(r.task.parentId) ?? null) : null,
      new Date(r.task.createdAt).toISOString(), new Date(r.task.updatedAt).toISOString(), r.task.description,
    ]),
  ]);
  return { filename: `${project.key.toLowerCase()}-tasks-${new Date().toISOString().slice(0, 10)}.csv`, csv, count: rows.length };
}
