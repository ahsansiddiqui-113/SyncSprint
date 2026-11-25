import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import { auditLogs, checklistItems, tags, taskDependencies, taskTags, tasks } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/fractional-index";
import { requireOrgPermission } from "@/lib/rbac";
import { TAG_COLORS } from "@/lib/tag-colors";

/**
 * Phase 2 "work breakdown": checklists, tags and dependencies.
 * Same rules as tasks: permission check first, every query tenant-scoped,
 * ids from another tenant behave exactly like missing ids, audit row in the same tx.
 */

async function taskInOrg(conn: DbOrTx, organizationId: string, taskId: string) {
  const [t] = await conn
    .select({ id: tasks.id, projectId: tasks.projectId, title: tasks.title, taskNumber: tasks.taskNumber })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  if (!t) throw new AppError("NOT_FOUND", "Task not found");
  return t;
}

/* ------------------------------ project meta ------------------------------ */

export type ProjectMeta = {
  checklist: Record<string, { done: number; total: number }>;
  tagsByTask: Record<string, string[]>;
  tags: { id: string; name: string; color: string }[];
  deps: { blockerId: string; blockedId: string }[];
};

/** Everything the views need to decorate cards, in four bounded queries. */
export async function getProjectMeta(conn: DB, actorId: string, organizationId: string, projectId: string): Promise<ProjectMeta> {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const inProject = and(eq(tasks.organizationId, organizationId), eq(tasks.projectId, projectId));

  const [checks, tagLinks, orgTags, deps] = await Promise.all([
    conn
      .select({
        taskId: checklistItems.taskId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${checklistItems.done})::int`,
      })
      .from(checklistItems)
      .innerJoin(tasks, eq(tasks.id, checklistItems.taskId))
      .where(and(eq(checklistItems.organizationId, organizationId), inProject))
      .groupBy(checklistItems.taskId),
    conn
      .select({ taskId: taskTags.taskId, tagId: taskTags.tagId })
      .from(taskTags)
      .innerJoin(tasks, eq(tasks.id, taskTags.taskId))
      .where(and(eq(taskTags.organizationId, organizationId), inProject)),
    conn
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(tags)
      .where(eq(tags.organizationId, organizationId))
      .orderBy(asc(tags.name)),
    conn
      .select({ blockerId: taskDependencies.blockerId, blockedId: taskDependencies.blockedId })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedId))
      .where(and(eq(taskDependencies.organizationId, organizationId), inProject)),
  ]);

  const tagsByTask: Record<string, string[]> = {};
  for (const l of tagLinks) (tagsByTask[l.taskId] ??= []).push(l.tagId);
  return {
    checklist: Object.fromEntries(checks.map((c) => [c.taskId, { done: c.done, total: c.total }])),
    tagsByTask,
    tags: orgTags,
    deps,
  };
}

/* -------------------------------- checklists ------------------------------- */

export async function listChecklist(conn: DB, actorId: string, organizationId: string, taskId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  await taskInOrg(conn, organizationId, taskId);
  return conn
    .select({ id: checklistItems.id, text: checklistItems.text, done: checklistItems.done, position: checklistItems.position })
    .from(checklistItems)
    .where(and(eq(checklistItems.organizationId, organizationId), eq(checklistItems.taskId, taskId)))
    .orderBy(asc(checklistItems.position));
}

export async function addChecklistItem(conn: DB, actorId: string, organizationId: string, taskId: string, rawText: string) {
  const text = z.string().trim().min(1).max(300).parse(rawText);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const task = await taskInOrg(tx, organizationId, taskId);
    const [last] = await tx
      .select({ position: checklistItems.position })
      .from(checklistItems)
      .where(eq(checklistItems.taskId, taskId))
      .orderBy(desc(checklistItems.position))
      .limit(1);
    const [item] = await tx
      .insert(checklistItems)
      .values({ organizationId, taskId, text, position: (last?.position ?? 0) + POSITION_STEP })
      .returning();
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: "CHECKLIST_ITEM_ADDED", entityType: "task", entityId: taskId,
      metadata: { itemId: item!.id, text },
    });
    return { item: item!, projectId: task.projectId };
  });
}

export async function setChecklistItemDone(conn: DB, actorId: string, organizationId: string, itemId: string, done: boolean) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [item] = await tx
      .update(checklistItems)
      .set({ done })
      .where(and(eq(checklistItems.id, itemId), eq(checklistItems.organizationId, organizationId)))
      .returning();
    if (!item) throw new AppError("NOT_FOUND", "Checklist item not found");
    const task = await taskInOrg(tx, organizationId, item.taskId);
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: done ? "CHECKLIST_ITEM_DONE" : "CHECKLIST_ITEM_REOPENED", entityType: "task", entityId: item.taskId,
      metadata: { itemId, text: item.text },
    });
    return { item, projectId: task.projectId };
  });
}

export async function deleteChecklistItem(conn: DB, actorId: string, organizationId: string, itemId: string) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [item] = await tx
      .delete(checklistItems)
      .where(and(eq(checklistItems.id, itemId), eq(checklistItems.organizationId, organizationId)))
      .returning();
    if (!item) throw new AppError("NOT_FOUND", "Checklist item not found");
    const task = await taskInOrg(tx, organizationId, item.taskId);
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: "CHECKLIST_ITEM_DELETED", entityType: "task", entityId: item.taskId,
      metadata: { itemId, text: item.text },
    });
    return { item, projectId: task.projectId };
  });
}

/* ----------------------------------- tags ---------------------------------- */

export const tagInput = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(TAG_COLORS),
});

export async function createTag(conn: DB, actorId: string, organizationId: string, raw: z.input<typeof tagInput>) {
  const input = tagInput.parse(raw);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    // Case-insensitive uniqueness: "Bug" and "bug" are the same tag.
    const [dupe] = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.organizationId, organizationId), sql`lower(${tags.name}) = lower(${input.name})`))
      .limit(1);
    if (dupe) throw new AppError("CONFLICT", `Tag "${input.name}" already exists`);
    const [tag] = await tx.insert(tags).values({ organizationId, ...input }).returning();
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: "TAG_CREATED", entityType: "tag", entityId: tag!.id, metadata: { name: input.name, color: input.color },
    });
    return tag!;
  });
}

export async function setTaskTag(conn: DB, actorId: string, organizationId: string, taskId: string, tagId: string, on: boolean) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const task = await taskInOrg(tx, organizationId, taskId);
    const [tag] = await tx
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(and(eq(tags.id, tagId), eq(tags.organizationId, organizationId)))
      .limit(1);
    if (!tag) throw new AppError("NOT_FOUND", "Tag not found");

    if (on) {
      const inserted = await tx.insert(taskTags).values({ organizationId, taskId, tagId }).onConflictDoNothing().returning();
      if (inserted.length === 0) return { projectId: task.projectId, changed: false };
    } else {
      const removed = await tx.delete(taskTags).where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId))).returning();
      if (removed.length === 0) return { projectId: task.projectId, changed: false };
    }
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: on ? "TAG_ADDED" : "TAG_REMOVED", entityType: "task", entityId: taskId, metadata: { tagId, name: tag.name },
    });
    return { projectId: task.projectId, changed: true };
  });
}

/* ------------------------------- dependencies ------------------------------ */

/** True if `from` can already reach `to` by following blocker → blocked edges. */
export function reaches(edges: { blockerId: string; blockedId: string }[], from: string, to: string): boolean {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.blockerId, [...(out.get(e.blockerId) ?? []), e.blockedId]);
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) return true;
    for (const next of out.get(cur) ?? []) if (!seen.has(next)) (seen.add(next), queue.push(next));
  }
  return false;
}

export async function addDependency(conn: DB, actorId: string, organizationId: string, blockerId: string, blockedId: string) {
  z.string().uuid().parse(blockerId);
  z.string().uuid().parse(blockedId);
  if (blockerId === blockedId) throw new AppError("VALIDATION", "A task can't block itself");
  await requireOrgPermission(actorId, organizationId, "member", conn);

  return conn.transaction(async (tx) => {
    const [blocker, blocked] = await Promise.all([taskInOrg(tx, organizationId, blockerId), taskInOrg(tx, organizationId, blockedId)]);
    if (blocker.projectId !== blocked.projectId) throw new AppError("VALIDATION", "Dependencies must be within one project");

    const edges = await tx
      .select({ blockerId: taskDependencies.blockerId, blockedId: taskDependencies.blockedId })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.blockedId))
      .where(and(eq(taskDependencies.organizationId, organizationId), eq(tasks.projectId, blocked.projectId)));
    // Adding blocker→blocked closes a loop iff blocked already (transitively) blocks blocker.
    if (reaches(edges, blockedId, blockerId)) throw new AppError("CONFLICT", "That would create a circular dependency");

    const inserted = await tx.insert(taskDependencies).values({ organizationId, blockerId, blockedId }).onConflictDoNothing().returning();
    if (inserted.length) {
      await tx.insert(auditLogs).values({
        organizationId, actorId, action: "DEPENDENCY_ADDED", entityType: "task", entityId: blockedId,
        metadata: { blockerId, blockedId, blockerTitle: blocker.title },
      });
    }
    return { projectId: blocked.projectId };
  });
}

export async function removeDependency(conn: DB, actorId: string, organizationId: string, blockerId: string, blockedId: string) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const blocked = await taskInOrg(tx, organizationId, blockedId);
    const removed = await tx
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.organizationId, organizationId),
          eq(taskDependencies.blockerId, blockerId),
          eq(taskDependencies.blockedId, blockedId)
        )
      )
      .returning();
    if (!removed.length) throw new AppError("NOT_FOUND", "Dependency not found");
    await tx.insert(auditLogs).values({
      organizationId, actorId, action: "DEPENDENCY_REMOVED", entityType: "task", entityId: blockedId, metadata: { blockerId, blockedId },
    });
    return { projectId: blocked.projectId };
  });
}
