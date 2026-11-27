import "server-only";
import { after } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/db";
import { boardColumns, organizations, projects, users, type Task } from "@/db/schema";
import { appBaseUrl } from "@/lib/base-url";
import { dispatchEvent, type WebhookEvent } from "@/server/services/webhooks";
import { chatActive, chatFromEvent } from "@/server/services/chat";

/** The public (API + webhook) shape of a task. Stable field names, no internal ids beyond ours. */
export type PublicTask = {
  id: string;
  ref: string;
  url: string;
  title: string;
  description: string | null;
  status: string;
  statusId: string;
  priority: Task["priority"];
  type: Task["type"];
  assignee: { id: string; name: string; email: string } | null;
  startDate: string | null;
  dueDate: string | null;
  storyPoints: number | null;
  estimateHours: number | null;
  sprintId: string | null;
  parentId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export async function toPublicTasks(conn: DbOrTx, organizationId: string, rows: Task[]): Promise<PublicTask[]> {
  if (!rows.length) return [];
  const [org] = await conn.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  const projectIds = [...new Set(rows.map((t) => t.projectId))];
  const columnIds = [...new Set(rows.map((t) => t.columnId))];
  const userIds = [...new Set(rows.map((t) => t.assigneeId).filter((u): u is string => !!u))];
  const [projs, cols, people] = await Promise.all([
    conn.select({ id: projects.id, key: projects.key }).from(projects).where(and(eq(projects.organizationId, organizationId), inArray(projects.id, projectIds))),
    conn.select({ id: boardColumns.id, title: boardColumns.title }).from(boardColumns).where(inArray(boardColumns.id, columnIds)),
    userIds.length ? conn.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
  ]);
  const key = new Map(projs.map((p) => [p.id, p.key]));
  const col = new Map(cols.map((c) => [c.id, c.title]));
  const person = new Map(people.map((p) => [p.id, p]));
  const base = appBaseUrl();
  return rows.map((t) => ({
    id: t.id,
    ref: `${key.get(t.projectId)}-${t.taskNumber}`,
    url: `${base}/w/${org?.slug}/projects/${key.get(t.projectId)}?task=${t.id}`,
    title: t.title,
    description: t.description,
    status: col.get(t.columnId) ?? "",
    statusId: t.columnId,
    priority: t.priority,
    type: t.type,
    assignee: t.assigneeId ? (person.get(t.assigneeId) ?? null) : null,
    startDate: t.startDate,
    dueDate: t.dueDate,
    storyPoints: t.storyPoints,
    estimateHours: t.estimateHours,
    sprintId: t.sprintId,
    parentId: t.parentId,
    version: t.version,
    createdAt: new Date(t.createdAt).toISOString(),
    updatedAt: new Date(t.updatedAt).toISOString(),
  }));
}

/**
 * Deliver webhooks after the response is sent (Next `after`), so a slow receiver never
 * slows down the person or API client who made the change.
 */
export function publishEvent(organizationId: string, event: WebhookEvent, build: () => Promise<unknown>) {
  const run = async () => {
    // Build the public payload at most once, shared by webhooks and chat alerts.
    let cached: Promise<unknown> | null = null;
    const lazy = () => (cached ??= build());
    try {
      await dispatchEvent(db, organizationId, event, lazy);
    } catch (err) {
      console.error("[webhooks] dispatch failed", err);
    }
    try {
      if (event !== "ping" && (await chatActive(db, organizationId))) await chatFromEvent(db, organizationId, event, await lazy());
    } catch (err) {
      console.error("[chat] delivery failed", err);
    }
  };
  try {
    after(run);
  } catch {
    void run(); // outside a request scope (scripts): fire and forget
  }
}

export function publishTask(organizationId: string, event: "task.created" | "task.updated", task: Task, extra: Record<string, unknown> = {}) {
  publishEvent(organizationId, event, async () => ({ task: (await toPublicTasks(db, organizationId, [task]))[0], ...extra }));
}
