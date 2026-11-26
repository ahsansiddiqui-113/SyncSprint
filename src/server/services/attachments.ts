import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { attachments, auditLogs, tasks, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Task attachments, stored in Postgres (bytea) so the app runs on serverless hosts
 * with no object storage. Deliberately small: 4 MB per file, 200 MB per workspace.
 *
 * Serving rules (see /api/attachments/[id]): membership is checked on every
 * download; only a short allow-list of raster image types is ever shown inline,
 * everything else downloads as an attachment with `nosniff` so an uploaded
 * HTML/SVG file can never execute in the app's origin.
 */

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const ORG_ATTACHMENT_QUOTA = 200 * 1024 * 1024;
export const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Strip path parts and control characters; keep a readable, bounded name. */
export function safeFilename(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_").trim().slice(0, 200);
  return cleaned || "file";
}

/** Never trust the browser's type for inline display; anything unusual becomes octet-stream. */
export function normalizeContentType(type: string | null | undefined) {
  const t = (type ?? "").toLowerCase().split(";")[0]!.trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t) ? t.slice(0, 120) : "application/octet-stream";
}

export async function uploadAttachment(
  conn: DB,
  actorId: string,
  organizationId: string,
  input: { taskId: string; filename: string; contentType: string | null; data: Buffer }
) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  if (input.data.length === 0) throw new AppError("VALIDATION", "The file is empty");
  if (input.data.length > MAX_ATTACHMENT_BYTES) throw new AppError("VALIDATION", "Files can be up to 4 MB");
  return conn.transaction(async (tx) => {
    const [task] = await tx
      .select({ id: tasks.id, projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.organizationId, organizationId)))
      .limit(1);
    if (!task) throw new AppError("NOT_FOUND", "Task not found");
    const [{ used }] = (await tx
      .select({ used: sql<number>`coalesce(sum(${attachments.size}), 0)::bigint` })
      .from(attachments)
      .where(eq(attachments.organizationId, organizationId))) as [{ used: number }];
    if (Number(used) + input.data.length > ORG_ATTACHMENT_QUOTA) {
      throw new AppError("QUOTA_EXCEEDED", "This workspace has used its 200 MB of attachment storage");
    }
    const filename = safeFilename(input.filename);
    const [row] = await tx
      .insert(attachments)
      .values({
        organizationId,
        taskId: task.id,
        uploadedById: actorId,
        filename,
        contentType: normalizeContentType(input.contentType),
        size: input.data.length,
        data: input.data,
      })
      .returning({ id: attachments.id, filename: attachments.filename, contentType: attachments.contentType, size: attachments.size, createdAt: attachments.createdAt });
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: "ATTACHMENT_ADDED", entityType: "task", entityId: task.id, metadata: { filename, size: input.data.length },
    });
    return { attachment: row!, projectId: task.projectId };
  });
}

export async function listAttachments(conn: DB, actorId: string, organizationId: string, taskId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn
    .select({
      id: attachments.id,
      filename: attachments.filename,
      contentType: attachments.contentType,
      size: attachments.size,
      createdAt: attachments.createdAt,
      uploadedById: attachments.uploadedById,
      uploadedByName: users.name,
    })
    .from(attachments)
    .leftJoin(users, eq(users.id, attachments.uploadedById))
    .where(and(eq(attachments.organizationId, organizationId), eq(attachments.taskId, taskId)))
    .orderBy(desc(attachments.createdAt));
}

/** Fetch bytes for download. Membership is enforced; foreign ids look missing. */
export async function readAttachment(conn: DB, actorId: string, attachmentId: string) {
  const [row] = await conn.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
  if (!row) throw new AppError("NOT_FOUND");
  try {
    await requireOrgPermission(actorId, row.organizationId, "viewer", conn);
  } catch {
    throw new AppError("NOT_FOUND"); // don't reveal that the id exists in another workspace
  }
  return row;
}

export async function deleteAttachment(conn: DB, actorId: string, organizationId: string, attachmentId: string) {
  const role = await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: attachments.id, taskId: attachments.taskId, uploadedById: attachments.uploadedById, filename: attachments.filename, projectId: tasks.projectId })
      .from(attachments)
      .innerJoin(tasks, eq(tasks.id, attachments.taskId))
      .where(and(eq(attachments.id, attachmentId), eq(attachments.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Attachment not found");
    if (row.uploadedById !== actorId && role !== "owner" && role !== "admin") {
      throw new AppError("FORBIDDEN", "Only the uploader or an admin can delete this file");
    }
    await tx.delete(attachments).where(eq(attachments.id, attachmentId));
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: "ATTACHMENT_DELETED", entityType: "task", entityId: row.taskId, metadata: { filename: row.filename },
    });
    return { taskId: row.taskId, projectId: row.projectId };
  });
}
