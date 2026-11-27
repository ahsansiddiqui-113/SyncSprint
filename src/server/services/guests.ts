import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, orgMembers, projectGuests, projects, taskComments, taskWatchers, tasks, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { projectReadView } from "./share-links";
import { notify } from "./notifications";

/**
 * Guests (ClickUp guests / Azure "Stakeholder" style): people from outside the company
 * (clients, contractors) who see only the projects they're added to and can comment there.
 *  - free (not a paid seat)
 *  - every other service keeps refusing them (the role passes no role check); access is
 *    granted only through the explicit per-project list checked here
 *  - read-only board, no live connection to the workspace, no emails of other people
 */

async function guestRole(conn: DB, userId: string, organizationId: string) {
  // Membership + workspace policy (2FA, IP allow-list, billing) via the shared guard.
  return requireOrgPermission(userId, organizationId, "guest", conn);
}

/** Projects this person may see as a guest (everything they're a member of otherwise). */
export async function guestProjects(conn: DB, userId: string, organizationId: string) {
  const role = await guestRole(conn, userId, organizationId);
  const q = conn.select({ id: projects.id, key: projects.key, name: projects.name, description: projects.description }).from(projects);
  if (role !== "guest") return q.where(eq(projects.organizationId, organizationId)).orderBy(asc(projects.key));
  return q
    .innerJoin(projectGuests, and(eq(projectGuests.projectId, projects.id), eq(projectGuests.userId, userId)))
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.key));
}

async function projectFor(conn: DB, userId: string, organizationId: string, match: { key?: string; id?: string }) {
  const list = await guestProjects(conn, userId, organizationId);
  const p = list.find((x) => (match.key ? x.key === match.key.toUpperCase() : x.id === match.id));
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
  return p;
}

export async function guestProjectView(conn: DB, userId: string, organizationId: string, projectKey: string) {
  const p = await projectFor(conn, userId, organizationId, { key: projectKey });
  return projectReadView(conn, organizationId, p, true);
}

/** Guests comment on tasks in their projects; the assignee and watchers are told. */
export async function guestComment(conn: DB, userId: string, organizationId: string, taskId: string, rawBody: string) {
  const body = z.string().trim().min(1, "Write something").max(5000).parse(rawBody);
  const [t] = await conn.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId))).limit(1);
  if (!t) throw new AppError("NOT_FOUND", "Task not found");
  await projectFor(conn, userId, organizationId, { id: t.projectId });
  const [c] = await conn.insert(taskComments).values({ organizationId, taskId, authorId: userId, body }).returning();
  await conn.insert(auditLogs).values({ organizationId, actorId: userId, action: "COMMENT_ADDED", entityType: "task", entityId: taskId, metadata: { via: "guest" } });
  const [me] = await conn.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  const watchers = await conn.select({ userId: taskWatchers.userId }).from(taskWatchers).where(eq(taskWatchers.taskId, taskId));
  const recipients = [...new Set([t.assigneeId, ...watchers.map((w) => w.userId)].filter((x): x is string => !!x))];
  const notified = await notify(conn, organizationId, userId, recipients.map((u) => ({ userId: u, kind: "comment" as const, taskId, title: `${me?.name ?? "A guest"} (guest) commented on ${t.title}`.slice(0, 200), body: body.slice(0, 300) })));
  return { comment: c!, notified, projectId: t.projectId };
}

/* ------------------------------------ admin ------------------------------------ */

export async function listGuestAccess(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const guests = await conn
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.role, "guest")))
    .orderBy(asc(users.name));
  const access = guests.length
    ? await conn.select({ userId: projectGuests.userId, projectId: projectGuests.projectId }).from(projectGuests).where(and(eq(projectGuests.organizationId, organizationId), inArray(projectGuests.userId, guests.map((g) => g.userId))))
    : [];
  return guests.map((g) => ({ ...g, projectIds: access.filter((a) => a.userId === g.userId).map((a) => a.projectId) }));
}

export async function setGuestProject(conn: DB, actorId: string, organizationId: string, userId: string, projectId: string, on: boolean) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [m] = await conn.select({ role: orgMembers.role }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, userId))).limit(1);
  if (!m) throw new AppError("NOT_FOUND", "Person not found");
  if (m.role !== "guest") throw new AppError("VALIDATION", "Only guests get per-project access; members and viewers see every project");
  const [p] = await conn.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
  if (on) await conn.insert(projectGuests).values({ organizationId, projectId, userId, addedById: actorId }).onConflictDoNothing();
  else await conn.delete(projectGuests).where(and(eq(projectGuests.projectId, projectId), eq(projectGuests.userId, userId)));
  await conn.insert(auditLogs).values({ organizationId, actorId, action: on ? "GUEST_PROJECT_ADDED" : "GUEST_PROJECT_REMOVED", entityType: "project", entityId: projectId, metadata: { userId } });
}
