import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import { auditLogs, boardColumns, projects, tasks, users, whiteboardItems, whiteboards, type Task, type WhiteboardItem } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { isAdminRole } from "@/lib/rbac-shared";
import { createTask } from "./tasks";
import { newEffects, type Effects } from "./task-effects";

/**
 * Whiteboards and mind maps (per project).
 *  - whiteboard: sticky notes, rectangles, ellipses, text, arrows between items, live task cards
 *  - mind map: a tree of nodes under one root; a branch can become a task with subtasks
 * Every item has a version (concurrent drags never overwrite each other) and every change
 * bumps the board's revision so open copies know to refresh.
 */

export const MAX_BOARDS_PER_PROJECT = 50;
export const MAX_ITEMS_PER_BOARD = 2000;
const KINDS = ["note", "rect", "ellipse", "text", "arrow", "task", "node"] as const;
const coord = z.number().finite().min(-1_000_000).max(1_000_000);
const size = z.number().finite().min(8).max(4000);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const uuid = z.string().uuid();

async function boardInOrg(conn: DbOrTx, organizationId: string, boardId: string) {
  const [b] = await conn.select().from(whiteboards).where(and(eq(whiteboards.id, boardId), eq(whiteboards.organizationId, organizationId))).limit(1);
  if (!b) throw new AppError("NOT_FOUND", "Board not found");
  return b;
}

/* ----------------------------------- boards ----------------------------------- */

export async function listBoards(conn: DB, actorId: string, organizationId: string, projectId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn
    .select({
      id: whiteboards.id, name: whiteboards.name, kind: whiteboards.kind, revision: whiteboards.revision, updatedAt: whiteboards.updatedAt,
      createdById: whiteboards.createdById, items: sql<number>`(select count(*)::int from whiteboard_items wi where wi.board_id = "whiteboards"."id")`,
    })
    .from(whiteboards)
    .where(and(eq(whiteboards.organizationId, organizationId), eq(whiteboards.projectId, projectId)))
    .orderBy(desc(whiteboards.updatedAt));
}

export async function createBoard(conn: DB, actorId: string, organizationId: string, projectId: string, raw: { name: string; kind: "whiteboard" | "mindmap" }) {
  const input = z.object({ name: z.string().trim().min(1, "Name the board").max(80), kind: z.enum(["whiteboard", "mindmap"]) }).parse(raw);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const [p] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
    if (!p) throw new AppError("NOT_FOUND", "Project not found");
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(whiteboards).where(eq(whiteboards.projectId, projectId))) as [{ n: number }];
    if (n >= MAX_BOARDS_PER_PROJECT) throw new AppError("VALIDATION", `A project can have up to ${MAX_BOARDS_PER_PROJECT} boards`);
    const [b] = await tx.insert(whiteboards).values({ organizationId, projectId, name: input.name, kind: input.kind, createdById: actorId }).returning();
    if (input.kind === "mindmap") {
      await tx.insert(whiteboardItems).values({ organizationId, boardId: b!.id, kind: "node", x: 0, y: 0, w: 180, h: 48, text: input.name, color: "#7b68ee", createdById: actorId });
    }
    await tx.insert(auditLogs).values({ organizationId, actorId, action: "BOARD_CREATED", entityType: "whiteboard", entityId: b!.id, metadata: { name: input.name, kind: input.kind } });
    return b!;
  });
}

export async function renameBoard(conn: DB, actorId: string, organizationId: string, boardId: string, rawName: string) {
  const name = z.string().trim().min(1).max(80).parse(rawName);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const [b] = await conn
    .update(whiteboards)
    .set({ name, revision: sql`${whiteboards.revision} + 1`, updatedAt: new Date() })
    .where(and(eq(whiteboards.id, boardId), eq(whiteboards.organizationId, organizationId)))
    .returning();
  if (!b) throw new AppError("NOT_FOUND", "Board not found");
  return b;
}

export async function deleteBoard(conn: DB, actorId: string, organizationId: string, boardId: string) {
  const role = await requireOrgPermission(actorId, organizationId, "member", conn);
  const b = await boardInOrg(conn, organizationId, boardId);
  if (b.createdById !== actorId && !isAdminRole(role)) throw new AppError("FORBIDDEN", "Only the board's creator or an admin can delete it");
  await conn.delete(whiteboards).where(eq(whiteboards.id, boardId));
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "BOARD_DELETED", entityType: "whiteboard", entityId: boardId, metadata: { name: b.name } });
  return { projectId: b.projectId };
}

/** The board, its items, and a live summary of every task an item points at. */
export async function getBoard(conn: DB, actorId: string, organizationId: string, boardId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const board = await boardInOrg(conn, organizationId, boardId);
  const items = await conn.select().from(whiteboardItems).where(eq(whiteboardItems.boardId, boardId)).orderBy(asc(whiteboardItems.z), asc(whiteboardItems.createdAt));
  const taskIds = [...new Set(items.map((i) => i.taskId).filter((t): t is string => !!t))];
  const linked = taskIds.length
    ? await conn
        .select({ id: tasks.id, title: tasks.title, taskNumber: tasks.taskNumber, key: projects.key, column: boardColumns.title, priority: tasks.priority, assignee: users.name, dueDate: tasks.dueDate })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
        .leftJoin(users, eq(users.id, tasks.assigneeId))
        .where(and(eq(tasks.organizationId, organizationId), inArray(tasks.id, taskIds)))
    : [];
  return { board, items, tasks: linked.map((t) => ({ ...t, ref: `${t.key}-${t.taskNumber}` })) };
}

/* ----------------------------------- items ----------------------------------- */

const itemFields = z.object({
  x: coord, y: coord, w: size, h: size,
  text: z.string().max(2000),
  color,
  fromId: uuid.nullable(), toId: uuid.nullable(), parentId: uuid.nullable(), taskId: uuid.nullable(),
  z: z.number().finite(),
  collapsed: z.boolean(),
});

export const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), kind: z.enum(KINDS), fields: itemFields.partial() }),
  z.object({ op: z.literal("update"), id: uuid, version: z.number().int().positive().optional(), fields: itemFields.partial() }),
  z.object({ op: z.literal("delete"), id: uuid }),
]);
export type BoardOp = z.input<typeof opSchema>;

/**
 * Apply a batch of item changes in one transaction. An update with a stale version is
 * skipped and reported as a conflict (with the current item) instead of overwriting.
 */
export async function applyBoardOps(conn: DB, actorId: string, organizationId: string, boardId: string, rawOps: BoardOp[]) {
  const ops = z.array(opSchema).min(1).max(100).parse(rawOps);
  await requireOrgPermission(actorId, organizationId, "member", conn);
  return conn.transaction(async (tx) => {
    const board = await boardInOrg(tx, organizationId, boardId);
    const existing = await tx.select({ id: whiteboardItems.id }).from(whiteboardItems).where(eq(whiteboardItems.boardId, boardId));
    const ids = new Set(existing.map((e) => e.id));
    const creates = ops.filter((o) => o.op === "create").length;
    if (ids.size + creates > MAX_ITEMS_PER_BOARD) throw new AppError("VALIDATION", `A board holds up to ${MAX_ITEMS_PER_BOARD} items`);

    const assertRefs = async (f: Partial<z.output<typeof itemFields>>) => {
      for (const ref of [f.fromId, f.toId, f.parentId]) if (ref && !ids.has(ref)) throw new AppError("VALIDATION", "Linked item isn't on this board");
      if (f.taskId) {
        const [t] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, f.taskId), eq(tasks.organizationId, organizationId), eq(tasks.projectId, board.projectId))).limit(1);
        if (!t) throw new AppError("NOT_FOUND", "Task not found in this project");
      }
    };

    const changed: WhiteboardItem[] = [];
    const deleted: string[] = [];
    const conflicts: WhiteboardItem[] = [];
    for (const o of ops) {
      if (o.op === "create") {
        await assertRefs(o.fields);
        if (o.kind === "arrow" && (!o.fields.fromId || !o.fields.toId)) throw new AppError("VALIDATION", "An arrow connects two items");
        if (o.kind === "node" && board.kind === "mindmap" && !o.fields.parentId) throw new AppError("VALIDATION", "A mind-map node needs a parent");
        const [it] = await tx.insert(whiteboardItems).values({ organizationId, boardId, kind: o.kind, createdById: actorId, ...o.fields }).returning();
        ids.add(it!.id);
        changed.push(it!);
      } else if (o.op === "update") {
        if (!ids.has(o.id)) continue; // gone already (someone deleted it)
        await assertRefs(o.fields);
        if (o.fields.parentId === o.id) throw new AppError("VALIDATION", "A node can't be its own parent");
        const where = o.version ? and(eq(whiteboardItems.id, o.id), eq(whiteboardItems.version, o.version)) : eq(whiteboardItems.id, o.id);
        const [it] = await tx.update(whiteboardItems).set({ ...o.fields, version: sql`${whiteboardItems.version} + 1` }).where(where).returning();
        if (it) changed.push(it);
        else {
          const [cur] = await tx.select().from(whiteboardItems).where(eq(whiteboardItems.id, o.id)).limit(1);
          if (cur) conflicts.push(cur);
        }
      } else {
        if (!ids.has(o.id)) continue;
        // Arrows and child nodes go with it (database cascade); report them gone too.
        const gone = await tx.delete(whiteboardItems).where(eq(whiteboardItems.id, o.id)).returning({ id: whiteboardItems.id });
        gone.forEach((g) => deleted.push(g.id));
        ids.delete(o.id);
      }
    }
    const [b] = await tx.update(whiteboards).set({ revision: sql`${whiteboards.revision} + 1`, updatedAt: new Date() }).where(eq(whiteboards.id, boardId)).returning({ revision: whiteboards.revision });
    return { revision: b!.revision, projectId: board.projectId, changed, deleted, conflicts };
  });
}

/* ------------------------------- items → tasks ------------------------------- */

const firstLine = (s: string) => (s.split("\n")[0] ?? "").trim().slice(0, 200) || "Untitled";
const rest = (s: string) => s.split("\n").slice(1).join("\n").trim() || null;

async function firstColumn(conn: DbOrTx, projectId: string) {
  const [c] = await conn.select({ id: boardColumns.id }).from(boardColumns).where(eq(boardColumns.projectId, projectId)).orderBy(asc(boardColumns.position)).limit(1);
  if (!c) throw new AppError("VALIDATION", "This project has no statuses");
  return c.id;
}

/** Turn a sticky note (or any item with text) into a task; the item then shows the live task. */
export async function convertItemToTask(conn: DB, actorId: string, organizationId: string, itemId: string, fx: Effects = newEffects()) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const [row] = await conn
    .select({ item: whiteboardItems, board: whiteboards })
    .from(whiteboardItems)
    .innerJoin(whiteboards, eq(whiteboards.id, whiteboardItems.boardId))
    .where(and(eq(whiteboardItems.id, itemId), eq(whiteboardItems.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Item not found");
  if (row.item.taskId) throw new AppError("CONFLICT", "This item is already a task");
  if (!row.item.text.trim()) throw new AppError("VALIDATION", "Write something on it first");
  const task = await createTask(conn, actorId, { organizationId, columnId: await firstColumn(conn, row.board.projectId), title: firstLine(row.item.text), description: rest(row.item.text) }, fx);
  await conn.update(whiteboardItems).set({ taskId: task.id, version: sql`${whiteboardItems.version} + 1` }).where(eq(whiteboardItems.id, itemId));
  await conn.update(whiteboards).set({ revision: sql`${whiteboards.revision} + 1`, updatedAt: new Date() }).where(eq(whiteboards.id, row.board.id));
  return { task, boardId: row.board.id, projectId: row.board.projectId };
}

/**
 * Mind map → tasks. A node becomes a task and every node under it a subtask of it.
 * The map's root itself isn't a task: each of its branches becomes one.
 * Nodes already linked to a task are skipped (run it again safely after adding ideas).
 */
export async function mindmapBranchToTasks(conn: DB, actorId: string, organizationId: string, nodeId: string, fx: Effects = newEffects()) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const [row] = await conn
    .select({ item: whiteboardItems, board: whiteboards })
    .from(whiteboardItems)
    .innerJoin(whiteboards, eq(whiteboards.id, whiteboardItems.boardId))
    .where(and(eq(whiteboardItems.id, nodeId), eq(whiteboardItems.organizationId, organizationId)))
    .limit(1);
  if (!row || row.item.kind !== "node") throw new AppError("NOT_FOUND", "Mind-map node not found");
  const all = await conn.select().from(whiteboardItems).where(and(eq(whiteboardItems.boardId, row.board.id), eq(whiteboardItems.kind, "node"))).orderBy(asc(whiteboardItems.y));
  const children = (id: string) => all.filter((n) => n.parentId === id);
  const below = (id: string): WhiteboardItem[] => children(id).flatMap((c) => [c, ...below(c.id)]);
  const columnId = await firstColumn(conn, row.board.projectId);
  const branches = row.item.parentId ? [row.item] : children(row.item.id);
  const created: Task[] = [];

  for (const branch of branches) {
    let parentTaskId = branch.taskId;
    if (!parentTaskId) {
      const t = await createTask(conn, actorId, { organizationId, columnId, title: firstLine(branch.text), description: rest(branch.text) }, fx);
      await conn.update(whiteboardItems).set({ taskId: t.id, version: sql`${whiteboardItems.version} + 1` }).where(eq(whiteboardItems.id, branch.id));
      created.push(t);
      parentTaskId = t.id;
    }
    for (const n of below(branch.id)) {
      if (n.taskId || !n.text.trim()) continue;
      const t = await createTask(conn, actorId, { organizationId, columnId, title: firstLine(n.text), description: rest(n.text), parentId: parentTaskId }, fx);
      await conn.update(whiteboardItems).set({ taskId: t.id, version: sql`${whiteboardItems.version} + 1` }).where(eq(whiteboardItems.id, n.id));
      created.push(t);
    }
  }
  await conn.update(whiteboards).set({ revision: sql`${whiteboards.revision} + 1`, updatedAt: new Date() }).where(eq(whiteboards.id, row.board.id));
  return { created, boardId: row.board.id, projectId: row.board.projectId };
}
