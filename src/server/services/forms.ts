import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, boardColumns, customFields, forms, orgMembers, organizations, projects, tags, taskTags, type FormField } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { isAdminRole } from "@/lib/rbac-shared";
import { createTask } from "./tasks";
import { setFieldValue } from "./customize";
import { notify } from "./notifications";
import { newEffects, type Effects } from "./task-effects";

/**
 * Intake forms (ClickUp Forms / Jira request forms): a public link anyone can fill in,
 * each submission becomes a task in the chosen status with the chosen assignee and tags.
 *  - built-in fields: title (always), description, name, email, priority, due date
 *  - plus any of the project's custom fields (custom:<fieldId>)
 *  - abuse limits: honeypot field, per-address rate limit, size caps; stops while the workspace is read-only
 */

const BUILTIN_KEYS = ["title", "description", "name", "email", "priority", "dueDate"] as const;
const MAX_FORMS = 30;

const fieldSchema = z.object({
  key: z.string().regex(/^(title|description|name|email|priority|dueDate|custom:[0-9a-f-]{36})$/, "Unknown form field"),
  label: z.string().trim().min(1).max(120),
  required: z.boolean(),
  help: z.string().trim().max(300).nullish(),
});
const formInput = z.object({
  name: z.string().trim().min(1, "Name the form").max(120),
  description: z.string().trim().max(1000).nullish(),
  fields: z.array(fieldSchema).min(1).max(25),
  columnId: z.string().uuid().nullish(),
  assigneeId: z.string().uuid().nullish(),
  tagIds: z.array(z.string().uuid()).max(10).default([]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  enabled: z.boolean().default(true),
});
export type FormInput = z.input<typeof formInput>;

/** The fields a new form starts with. */
export const DEFAULT_FIELDS: FormField[] = [
  { key: "title", label: "Summary", required: true },
  { key: "description", label: "Details", required: false, help: "Steps, links, what you expected to happen" },
  { key: "name", label: "Your name", required: true },
  { key: "email", label: "Your email", required: true },
];

async function validateRefs(conn: DB, organizationId: string, projectId: string, input: z.output<typeof formInput>) {
  if (!input.fields.some((f) => f.key === "title")) throw new AppError("VALIDATION", "A form needs the Summary (title) field");
  if (new Set(input.fields.map((f) => f.key)).size !== input.fields.length) throw new AppError("VALIDATION", "Each field can appear once");
  const customIds = input.fields.filter((f) => f.key.startsWith("custom:")).map((f) => f.key.slice(7));
  if (customIds.length) {
    const found = await conn.select({ id: customFields.id }).from(customFields).where(and(eq(customFields.projectId, projectId), inArray(customFields.id, customIds)));
    if (found.length !== customIds.length) throw new AppError("VALIDATION", "A custom field on the form isn't in this project");
  }
  if (input.columnId) {
    const [c] = await conn.select({ id: boardColumns.id }).from(boardColumns).where(and(eq(boardColumns.id, input.columnId), eq(boardColumns.projectId, projectId))).limit(1);
    if (!c) throw new AppError("VALIDATION", "That status isn't in this project");
  }
  if (input.assigneeId) {
    const [m] = await conn.select({ id: orgMembers.id }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, input.assigneeId))).limit(1);
    if (!m) throw new AppError("VALIDATION", "The assignee isn't in this workspace");
  }
  if (input.tagIds.length) {
    const t = await conn.select({ id: tags.id }).from(tags).where(and(eq(tags.organizationId, organizationId), inArray(tags.id, input.tagIds)));
    if (t.length !== new Set(input.tagIds).size) throw new AppError("VALIDATION", "A tag isn't in this workspace");
  }
}

async function projectInOrg(conn: DB, organizationId: string, projectId: string) {
  const [p] = await conn.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
}

export async function listForms(conn: DB, actorId: string, organizationId: string, projectId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn.select().from(forms).where(and(eq(forms.organizationId, organizationId), eq(forms.projectId, projectId))).orderBy(desc(forms.createdAt));
}

export async function createForm(conn: DB, actorId: string, organizationId: string, projectId: string, raw: FormInput) {
  const input = formInput.parse(raw);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  await projectInOrg(conn, organizationId, projectId);
  await validateRefs(conn, organizationId, projectId, input);
  const [{ n }] = (await conn.select({ n: sql<number>`count(*)::int` }).from(forms).where(eq(forms.projectId, projectId))) as [{ n: number }];
  if (n >= MAX_FORMS) throw new AppError("VALIDATION", `A project can have up to ${MAX_FORMS} forms`);
  const [f] = await conn
    .insert(forms)
    .values({ organizationId, projectId, ...input, description: input.description ?? null, columnId: input.columnId ?? null, assigneeId: input.assigneeId ?? null, token: randomBytes(16).toString("base64url"), createdById: actorId })
    .returning();
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "FORM_CREATED", entityType: "project", entityId: projectId, metadata: { name: input.name } });
  return f!;
}

async function formInOrg(conn: DB, organizationId: string, formId: string) {
  const [f] = await conn.select().from(forms).where(and(eq(forms.id, formId), eq(forms.organizationId, organizationId))).limit(1);
  if (!f) throw new AppError("NOT_FOUND", "Form not found");
  return f;
}

export async function updateForm(conn: DB, actorId: string, organizationId: string, formId: string, raw: FormInput) {
  const input = formInput.parse(raw);
  const role = await requireOrgPermission(actorId, organizationId, "member", conn);
  const f = await formInOrg(conn, organizationId, formId);
  if (f.createdById !== actorId && !isAdminRole(role)) throw new AppError("FORBIDDEN", "Only the form's creator or an admin can change it");
  await validateRefs(conn, organizationId, f.projectId, input);
  const [u] = await conn.update(forms).set({ ...input, description: input.description ?? null, columnId: input.columnId ?? null, assigneeId: input.assigneeId ?? null }).where(eq(forms.id, formId)).returning();
  return u!;
}

export async function deleteForm(conn: DB, actorId: string, organizationId: string, formId: string) {
  const role = await requireOrgPermission(actorId, organizationId, "member", conn);
  const f = await formInOrg(conn, organizationId, formId);
  if (f.createdById !== actorId && !isAdminRole(role)) throw new AppError("FORBIDDEN", "Only the form's creator or an admin can delete it");
  await conn.delete(forms).where(eq(forms.id, formId));
}

/** A fresh link; the old one stops working. */
export async function rotateFormLink(conn: DB, actorId: string, organizationId: string, formId: string) {
  const role = await requireOrgPermission(actorId, organizationId, "member", conn);
  const f = await formInOrg(conn, organizationId, formId);
  if (f.createdById !== actorId && !isAdminRole(role)) throw new AppError("FORBIDDEN");
  const [u] = await conn.update(forms).set({ token: randomBytes(16).toString("base64url") }).where(eq(forms.id, formId)).returning({ token: forms.token });
  return u!.token;
}

/* ------------------------------------ public ------------------------------------ */

async function formByToken(conn: DB, token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null;
  const [row] = await conn
    .select({ form: forms, orgName: organizations.name, projectName: projects.name })
    .from(forms)
    .innerJoin(organizations, eq(organizations.id, forms.organizationId))
    .innerJoin(projects, eq(projects.id, forms.projectId))
    .where(eq(forms.token, token))
    .limit(1);
  return row ?? null;
}

/** What the public page needs: labels and options only (no ids beyond the custom field keys, no people). */
export async function getPublicForm(conn: DB, token: string) {
  const row = await formByToken(conn, token);
  if (!row || !row.form.enabled) return null;
  const customIds = row.form.fields.filter((f) => f.key.startsWith("custom:")).map((f) => f.key.slice(7));
  const defs = customIds.length ? await conn.select().from(customFields).where(inArray(customFields.id, customIds)) : [];
  return {
    name: row.form.name,
    description: row.form.description,
    workspace: row.orgName,
    fields: row.form.fields.map((f) => {
      const def = f.key.startsWith("custom:") ? defs.find((d) => d.id === f.key.slice(7)) : undefined;
      const type = def ? def.type : f.key === "priority" ? "select" : f.key === "dueDate" ? "date" : f.key === "description" ? "textarea" : f.key === "email" ? "email" : "text";
      const options = def?.type === "select" ? def.options.map((o) => ({ value: o.id, label: o.label })) : f.key === "priority" ? ["low", "medium", "high", "urgent"].map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) })) : undefined;
      return { ...f, type: def?.type === "person" ? "text" : type, options };
    }),
  };
}

// Per-address submission limit (per server instance): 10 per 10 minutes per form.
const hits = new Map<string, number[]>();
function rateLimited(key: string, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 10 * 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const k of [...hits.keys()].slice(0, 1000)) hits.delete(k);
  return recent.length > 10;
}

export async function submitForm(conn: DB, token: string, values: Record<string, string>, meta: { ip: string | null; honeypot?: string }, fx: Effects = newEffects()) {
  const row = await formByToken(conn, token);
  if (!row || !row.form.enabled) throw new AppError("NOT_FOUND", "This form isn't available");
  // Bots fill every field, including the invisible one: pretend it worked.
  if (meta.honeypot) return { ok: true as const, ref: null };
  if (rateLimited(`${token}:${meta.ip ?? "?"}`)) throw new AppError("QUOTA_EXCEEDED", "Too many submissions from your network. Try again in a few minutes.");
  const f = row.form;
  const get = (k: string) => (values[k] ?? "").toString().trim();
  for (const field of f.fields) if (field.required && !get(field.key)) throw new AppError("VALIDATION", `${field.label} is required`);
  const title = get("title").slice(0, 200);
  if (!title) throw new AppError("VALIDATION", "A summary is required");
  const email = get("email");
  if (email && !z.string().email().max(255).safeParse(email).success) throw new AppError("VALIDATION", "That email doesn't look right");
  const due = get("dueDate");
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new AppError("VALIDATION", "Pick a valid date");
  const priority = (["low", "medium", "high", "urgent"] as const).find((p) => p === get("priority")) ?? f.priority;

  // Act as the form's creator; if they've left, as any admin of the workspace.
  let actorId = f.createdById;
  const isMember = actorId ? (await conn.select({ id: orgMembers.id }).from(orgMembers).where(and(eq(orgMembers.organizationId, f.organizationId), eq(orgMembers.userId, actorId))).limit(1)).length > 0 : false;
  if (!isMember) {
    const [admin] = await conn.select({ userId: orgMembers.userId }).from(orgMembers).where(and(eq(orgMembers.organizationId, f.organizationId), inArray(orgMembers.role, ["admin", "owner"]))).orderBy(asc(orgMembers.joinedAt)).limit(1);
    actorId = admin?.userId ?? null;
  }
  if (!actorId) throw new AppError("NOT_FOUND", "This form isn't available");

  const cols = await conn.select({ id: boardColumns.id }).from(boardColumns).where(eq(boardColumns.projectId, f.projectId)).orderBy(asc(boardColumns.position));
  const columnId = f.columnId && cols.some((c) => c.id === f.columnId) ? f.columnId : cols[0]?.id;
  if (!columnId) throw new AppError("NOT_FOUND", "This form isn't available");
  const who = [get("name"), email ? `<${email}>` : ""].filter(Boolean).join(" ");
  const description = [get("description"), `— Submitted with the form "${f.name}"${who ? ` by ${who}` : ""}`].filter(Boolean).join("\n\n").slice(0, 10_000);

  let task;
  try {
    task = await createTask(conn, actorId, { organizationId: f.organizationId, columnId, title, description, priority, assigneeId: f.assigneeId, dueDate: due || null }, fx);
  } catch (err) {
    if (err instanceof AppError && (err.code === "WORKSPACE_READ_ONLY" || err.code === "WORKSPACE_LOCKED")) throw new AppError("NOT_FOUND", "This form isn't accepting responses right now");
    throw err;
  }
  if (f.tagIds.length) {
    const live = await conn.select({ id: tags.id }).from(tags).where(and(eq(tags.organizationId, f.organizationId), inArray(tags.id, f.tagIds)));
    if (live.length) await conn.insert(taskTags).values(live.map((t) => ({ taskId: task.id, tagId: t.id, organizationId: f.organizationId }))).onConflictDoNothing();
  }
  const customKeys = f.fields.filter((x) => x.key.startsWith("custom:")).map((x) => x.key.slice(7));
  const defs = customKeys.length ? await conn.select({ id: customFields.id, type: customFields.type }).from(customFields).where(inArray(customFields.id, customKeys)) : [];
  for (const def of defs) {
    const v = get(`custom:${def.id}`);
    if (!v) continue;
    const value = def.type === "number" ? Number(v) : v;
    if (def.type === "number" && !Number.isFinite(value)) continue;
    await setFieldValue(conn, actorId, f.organizationId, task.id, def.id, value).catch(() => undefined); // a bad custom value never loses the submission
  }
  await conn.update(forms).set({ submissions: sql`${forms.submissions} + 1` }).where(eq(forms.id, f.id));
  const [proj] = await conn.select({ key: projects.key }).from(projects).where(eq(projects.id, f.projectId)).limit(1);
  const [org] = await conn.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, f.organizationId)).limit(1);
  const ref = `${proj!.key}-${task.taskNumber}`;
  const recipients = [...new Set([f.createdById, f.assigneeId].filter((x): x is string => !!x))];
  const notified = await notify(conn, f.organizationId, null, recipients.map((userId) => ({
    userId, kind: "form" as const, taskId: task.id, title: `New ${f.name} response: ${title}`.slice(0, 200), body: who || null,
    link: `/w/${org!.slug}/projects/${proj!.key}?task=${task.id}`,
  })));
  return { ok: true as const, ref, task, notified, organizationId: f.organizationId };
}

export const FORM_BUILTIN_KEYS = BUILTIN_KEYS;
