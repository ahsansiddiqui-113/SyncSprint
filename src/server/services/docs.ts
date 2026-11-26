import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, docTasks, docs, projects, tasks, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { isAdminRole } from "@/lib/rbac-shared";

/**
 * Docs: workspace wiki pages in markdown. Saving uses the same optimistic
 * concurrency as tasks (expected version), so two people editing at once never
 * silently overwrite each other: the second save gets VERSION_CONFLICT.
 * Markdown is rendered client-side without raw HTML, so content can't inject script.
 */

const MAX_CONTENT = 100_000;

const titleSchema = z.string().trim().min(1, "Give the doc a title").max(160);

export async function listDocs(conn: DB, actorId: string, organizationId: string, opts: { q?: string } = {}) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const q = opts.q?.trim().slice(0, 80);
  return conn
    .select({
      id: docs.id,
      title: docs.title,
      updatedAt: docs.updatedAt,
      updatedByName: users.name,
      excerpt: sql<string>`left(${docs.content}, 160)`,
      linkedTasks: sql<number>`(select count(*)::int from ${docTasks} where ${docTasks.docId} = "docs"."id")`,
    })
    .from(docs)
    .leftJoin(users, eq(users.id, docs.updatedById))
    .where(and(eq(docs.organizationId, organizationId), q ? ilike(docs.title, `%${q.replace(/[%_\\]/g, "\\$&")}%`) : sql`true`))
    .orderBy(desc(docs.updatedAt))
    .limit(200);
}

export async function getDoc(conn: DB, actorId: string, organizationId: string, docId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const [row] = await conn
    .select({ doc: docs, updatedByName: users.name })
    .from(docs)
    .leftJoin(users, eq(users.id, docs.updatedById))
    .where(and(eq(docs.id, docId), eq(docs.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Doc not found");
  const linked = await conn
    .select({ id: tasks.id, title: tasks.title, taskNumber: tasks.taskNumber, key: projects.key })
    .from(docTasks)
    .innerJoin(tasks, eq(tasks.id, docTasks.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(docTasks.docId, docId), eq(docTasks.organizationId, organizationId)));
  return {
    ...row.doc,
    updatedByName: row.updatedByName,
    tasks: linked.map((t) => ({ id: t.id, title: t.title, ref: `${t.key}-${t.taskNumber}`, projectKey: t.key })),
  };
}

export async function createDoc(conn: DB, actorId: string, organizationId: string, raw: { title: string; content?: string }) {
  const input = z.object({ title: titleSchema, content: z.string().max(MAX_CONTENT).default("") }).parse(raw);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [doc] = await tx
      .insert(docs)
      .values({ organizationId, title: input.title, content: input.content, createdById: actorId, updatedById: actorId })
      .returning();
    await tx.insert(auditLogs).values({ organizationId, actorId, action: "DOC_CREATED", entityType: "doc", entityId: doc!.id, metadata: { title: input.title } });
    return doc!;
  });
}

export async function updateDoc(
  conn: DB,
  actorId: string,
  organizationId: string,
  raw: { docId: string; expectedVersion: number; title?: string; content?: string }
) {
  const input = z
    .object({
      docId: z.string().uuid(),
      expectedVersion: z.number().int().min(1),
      title: titleSchema.optional(),
      content: z.string().max(MAX_CONTENT, "Docs can be up to 100,000 characters").optional(),
    })
    .parse(raw);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [updated] = await tx
      .update(docs)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        updatedById: actorId,
        updatedAt: new Date(),
        version: sql`${docs.version} + 1`,
      })
      .where(and(eq(docs.id, input.docId), eq(docs.organizationId, organizationId), eq(docs.version, input.expectedVersion)))
      .returning();
    if (!updated) {
      const [exists] = await tx.select({ version: docs.version }).from(docs).where(and(eq(docs.id, input.docId), eq(docs.organizationId, organizationId))).limit(1);
      if (!exists) throw new AppError("NOT_FOUND", "Doc not found");
      throw new AppError("VERSION_CONFLICT", "Someone else saved this doc. Reload to see their changes.");
    }
    await tx.insert(auditLogs).values({ organizationId, actorId, action: "DOC_UPDATED", entityType: "doc", entityId: input.docId, metadata: { version: updated.version } });
    return updated;
  });
}

export async function deleteDoc(conn: DB, actorId: string, organizationId: string, docId: string) {
  const role = await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [d] = await tx.select({ id: docs.id, title: docs.title, createdById: docs.createdById }).from(docs).where(and(eq(docs.id, docId), eq(docs.organizationId, organizationId))).limit(1);
    if (!d) throw new AppError("NOT_FOUND", "Doc not found");
    if (d.createdById !== actorId && !isAdminRole(role)) throw new AppError("FORBIDDEN", "Only the author or an admin can delete this doc");
    await tx.delete(docs).where(eq(docs.id, docId));
    await tx.insert(auditLogs).values({ organizationId, actorId, action: "DOC_DELETED", entityType: "doc", entityId: docId, metadata: { title: d.title } });
  });
}

/** Link/unlink a task. Both ids must belong to this workspace. */
export async function setDocTaskLink(conn: DB, actorId: string, organizationId: string, docId: string, taskId: string, linked: boolean) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [d] = await tx.select({ id: docs.id }).from(docs).where(and(eq(docs.id, docId), eq(docs.organizationId, organizationId))).limit(1);
    const [t] = await tx.select({ id: tasks.id, projectId: tasks.projectId }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId))).limit(1);
    if (!d || !t) throw new AppError("NOT_FOUND", "Doc or task not found");
    if (linked) await tx.insert(docTasks).values({ organizationId, docId, taskId }).onConflictDoNothing();
    else await tx.delete(docTasks).where(and(eq(docTasks.docId, docId), eq(docTasks.taskId, taskId)));
    return { projectId: t.projectId };
  });
}

/** Docs linked to a task (for the task drawer). */
export async function docsForTask(conn: DB, actorId: string, organizationId: string, taskId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn
    .select({ id: docs.id, title: docs.title })
    .from(docTasks)
    .innerJoin(docs, eq(docs.id, docTasks.docId))
    .where(and(eq(docTasks.organizationId, organizationId), eq(docTasks.taskId, taskId)))
    .orderBy(docs.title);
}

/** Task search for link pickers (docs, goals). */
export async function searchTasks(conn: DB, actorId: string, organizationId: string, q: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const term = q.trim().slice(0, 80);
  const m = /^([a-z][a-z0-9]{0,9})-(\d+)$/i.exec(term);
  const rows = await conn
    .select({ id: tasks.id, title: tasks.title, taskNumber: tasks.taskNumber, key: projects.key })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        m
          ? and(eq(projects.key, m[1]!.toUpperCase()), eq(tasks.taskNumber, Number(m[2])))
          : term
            ? ilike(tasks.title, `%${term.replace(/[%_\\]/g, "\\$&")}%`)
            : sql`true`
      )
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(12);
  return rows.map((t) => ({ id: t.id, title: t.title, ref: `${t.key}-${t.taskNumber}` }));
}

