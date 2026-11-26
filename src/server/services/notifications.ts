import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import {
  boardColumns,
  notifications,
  orgMembers,
  organizations,
  projects,
  taskAssignees,
  taskWatchers,
  tasks,
  users,
  type NotificationKind,
} from "@/db/schema";
import { requireOrgPermission } from "@/lib/rbac";
import { MENTION_SOURCE } from "@/lib/mentions";

/**
 * In-app notifications. Rules:
 *  - never notify the person who did the action
 *  - only current workspace members receive anything (tenant-safe fan-out)
 *  - each recipient gets at most one notification per event (mention beats comment)
 *  - optional dedupe key (unique per recipient) for alerts like "over capacity today"
 */

export type NewNotification = {
  userId: string;
  kind: NotificationKind;
  taskId?: string | null;
  title: string;
  body?: string | null;
  link?: string | null;
  dedupeKey?: string | null;
};

/** Insert notifications; returns the recipients actually notified. */
export async function notify(conn: DbOrTx, organizationId: string, actorId: string | null, items: NewNotification[]): Promise<string[]> {
  const wanted = items.filter((n) => n.userId && n.userId !== actorId);
  if (!wanted.length) return [];
  const members = await conn
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, organizationId), inArray(orgMembers.userId, [...new Set(wanted.map((n) => n.userId))])));
  const allowed = new Set(members.map((m) => m.userId));
  const seen = new Set<string>();
  const rows = wanted.filter((n) => {
    // One notification per recipient per event: the first item for a person wins
    // (callers list mentions before plain comments).
    const key = n.dedupeKey ? `${n.userId}:${n.dedupeKey}` : n.userId;
    if (!allowed.has(n.userId) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!rows.length) return [];
  const inserted = await conn
    .insert(notifications)
    .values(
      rows.map((n) => ({
        organizationId,
        userId: n.userId,
        actorId,
        kind: n.kind,
        taskId: n.taskId ?? null,
        title: n.title.slice(0, 200),
        body: n.body ? n.body.slice(0, 300) : null,
        link: n.link ?? null,
        dedupeKey: n.dedupeKey ?? null,
      }))
    )
    .onConflictDoNothing()
    .returning({ userId: notifications.userId });
  return [...new Set(inserted.map((r) => r.userId))];
}

/* ------------------------------- task context ------------------------------ */

export type TaskContext = {
  id: string;
  ref: string;
  title: string;
  link: string;
  assigneeId: string | null;
  coAssignees: string[];
  watchers: string[];
  projectId: string;
  doneColumnId: string | null;
};

/** Everything needed to address notifications about one task. */
export async function taskContext(conn: DbOrTx, organizationId: string, taskId: string): Promise<TaskContext | null> {
  const [row] = await conn
    .select({ task: tasks, key: projects.key, slug: organizations.slug })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(organizations, eq(organizations.id, tasks.organizationId))
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  if (!row) return null;
  const [co, watch, done] = await Promise.all([
    conn.select({ userId: taskAssignees.userId }).from(taskAssignees).where(eq(taskAssignees.taskId, taskId)),
    conn.select({ userId: taskWatchers.userId }).from(taskWatchers).where(eq(taskWatchers.taskId, taskId)),
    conn
      .select({ id: boardColumns.id })
      .from(boardColumns)
      .where(eq(boardColumns.projectId, row.task.projectId))
      .orderBy(desc(boardColumns.position))
      .limit(1),
  ]);
  return {
    id: taskId,
    ref: `${row.key}-${row.task.taskNumber}`,
    title: row.task.title,
    link: `/w/${row.slug}/projects/${row.key}?task=${taskId}`,
    assigneeId: row.task.assigneeId,
    coAssignees: co.map((c) => c.userId),
    watchers: watch.map((w) => w.userId),
    projectId: row.task.projectId,
    doneColumnId: done[0]?.id ?? null,
  };
}

export async function nameOf(conn: DbOrTx, userId: string | null) {
  if (!userId) return "Someone";
  const [u] = await conn.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.name ?? "Someone";
}

/* --------------------------------- mentions -------------------------------- */

/** Mentions are stored inline as @[Display Name](user-uuid). */
const MENTION_RE = new RegExp(MENTION_SOURCE, "gi");

export function extractMentions(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) ids.add(m[2]!.toLowerCase());
  return [...ids];
}

/** Plain-text version for notification previews: "@[Sara](id)" → "@Sara". */
export function mentionsToText(body: string) {
  return body.replace(MENTION_RE, (_, name: string) => `@${name}`);
}

/* ---------------------------------- inbox ---------------------------------- */

export async function listNotifications(conn: DB, actorId: string, organizationId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const limit = z.number().int().min(1).max(100).parse(opts.limit ?? 40);
  const rows = await conn
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title: notifications.title,
      body: notifications.body,
      link: notifications.link,
      taskId: notifications.taskId,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorId: notifications.actorId,
      actorName: users.name,
      actorAvatar: users.avatarUrl,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.userId, actorId),
        opts.unreadOnly ? isNull(notifications.readAt) : sql`true`
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  const [{ unread }] = (await conn
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.organizationId, organizationId), eq(notifications.userId, actorId), isNull(notifications.readAt)))) as [{ unread: number }];
  return { items: rows, unread };
}

/** Mark specific notifications (or all, when ids is empty) as read. Only the recipient can. */
export async function markRead(conn: DB, actorId: string, organizationId: string, ids: string[] = []) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const valid = z.array(z.string().uuid()).max(200).parse(ids);
  await conn
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.userId, actorId),
        isNull(notifications.readAt),
        valid.length ? inArray(notifications.id, valid) : sql`true`
      )
    );
}

/* --------------------------- capacity manager alert -------------------------- */

/**
 * Tell owners/admins when work pushes someone over capacity — at most once per
 * person per day per manager (dedupe key), so it never turns into noise.
 */
export async function alertManagersOverCapacity(
  conn: DbOrTx,
  organizationId: string,
  actorId: string | null,
  over: { userId: string; name: string; day: string; load: number; capacity: number }[],
  link: string | null
) {
  if (!over.length) return [];
  const managers = await conn
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.organizationId, organizationId), inArray(orgMembers.role, ["owner", "admin"])));
  const items: NewNotification[] = [];
  for (const m of managers) {
    for (const o of over) {
      if (m.userId === o.userId) continue; // the overloaded person isn't their own manager here
      items.push({
        userId: m.userId,
        kind: "capacity",
        title: `${o.name} is over capacity`,
        body: `${Math.round(o.load * 10) / 10}h of ${Math.round(o.capacity * 10) / 10}h on ${o.day}. Consider rebalancing their work.`,
        link,
        dedupeKey: `capacity:${o.userId}:${o.day}`,
      });
    }
  }
  return notify(conn, organizationId, actorId, items);
}

/* ------------------------------ event helpers ------------------------------ */
// Called inside the same transaction as the change, so a rolled-back change never notifies.

/** "Sara assigned you ENG-12". */
export async function notifyAssigned(conn: DbOrTx, organizationId: string, actorId: string, taskId: string, userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u && u !== actorId))];
  if (!ids.length) return [];
  const ctx = await taskContext(conn, organizationId, taskId);
  if (!ctx) return [];
  const who = await nameOf(conn, actorId);
  return notify(
    conn,
    organizationId,
    actorId,
    ids.map((userId) => ({ userId, kind: "assigned" as const, taskId, title: `${who} assigned you ${ctx.ref}`, body: ctx.title, link: ctx.link }))
  );
}

/** Mentions first (they win the per-person dedupe), then assignees + watchers get "commented". */
export async function notifyComment(conn: DbOrTx, organizationId: string, actorId: string, taskId: string, body: string) {
  const ctx = await taskContext(conn, organizationId, taskId);
  if (!ctx) return [];
  const who = await nameOf(conn, actorId);
  const preview = mentionsToText(body).slice(0, 300);
  const items: NewNotification[] = [
    ...extractMentions(body).map((userId) => ({ userId, kind: "mention" as const, taskId, title: `${who} mentioned you on ${ctx.ref}`, body: preview, link: ctx.link })),
    ...[ctx.assigneeId, ...ctx.coAssignees, ...ctx.watchers]
      .filter((u): u is string => !!u)
      .map((userId) => ({ userId, kind: "comment" as const, taskId, title: `${who} commented on ${ctx.ref}`, body: preview, link: ctx.link })),
  ];
  return notify(conn, organizationId, actorId, items);
}

/** A task reached its project's Done column: tell the people who care. */
export async function notifyCompleted(conn: DbOrTx, organizationId: string, actorId: string, taskId: string) {
  const ctx = await taskContext(conn, organizationId, taskId);
  if (!ctx) return [];
  const who = await nameOf(conn, actorId);
  return notify(
    conn,
    organizationId,
    actorId,
    [ctx.assigneeId, ...ctx.coAssignees, ...ctx.watchers]
      .filter((u): u is string => !!u)
      .map((userId) => ({ userId, kind: "completed" as const, taskId, title: `${who} completed ${ctx.ref}`, body: ctx.title, link: ctx.link }))
  );
}
