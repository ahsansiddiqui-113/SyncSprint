import { randomBytes } from "node:crypto";
import { and, asc, eq, ne } from "drizzle-orm";
import type { DB } from "@/db";
import {
  auditLogs,
  boardColumns,
  orgMembers,
  organizations,
  projects,
  tasks,
  users,
  type OrgRole,
  type TaskPriority,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { POSITION_STEP, positionForIndex } from "@/lib/fractional-index";
import { DEFAULT_COLUMNS } from "./workspace";
import { moveTask, updateTask } from "./tasks";

type SeedTask = { title: string; priority: TaskPriority; column: number; assignee?: number; description?: string };

const TEAMMATES = [
  { name: "Sara Chen", role: "owner" as const },
  { name: "Alex Rivera", role: "admin" as const },
  { name: "Priya Patel", role: "member" as const },
  { name: "Marcus Lee", role: "viewer" as const },
];

const ENG_TASKS: SeedTask[] = [
  { title: "Build multi-tenant billing webhook handler", priority: "high", column: 0, assignee: 1, description: "Handle Stripe `invoice.paid` and `customer.subscription.updated`. Must be idempotent and tenant-scoped." },
  { title: "Add rate limiting to public API", priority: "medium", column: 0 },
  { title: "Migrate session store to Postgres", priority: "low", column: 0 },
  { title: "Audit log export to CSV", priority: "medium", column: 0, assignee: 2 },
  { title: "Fix N+1 query on project list", priority: "urgent", column: 1, assignee: 0, description: "Dashboard p95 is 1.8s for orgs with 50+ projects." },
  { title: "SSO (SAML) for enterprise tenants", priority: "high", column: 1, assignee: 1 },
  { title: "Keyboard shortcuts for board navigation", priority: "low", column: 1, assignee: 2 },
  { title: "Row-level security policies for tasks", priority: "high", column: 2, assignee: 0 },
  { title: "Invite flow: email domain allow-list", priority: "medium", column: 2 },
  { title: "Set up CI with Vitest + Playwright", priority: "medium", column: 3, assignee: 2 },
  { title: "Design tokens + dark mode", priority: "low", column: 3, assignee: 1 },
  { title: "Fractional indexing for card order", priority: "high", column: 3, assignee: 0 },
];

const OPS_TASKS: SeedTask[] = [
  { title: "Rotate database credentials", priority: "urgent", column: 0, assignee: 1 },
  { title: "Set up uptime alerts for WebSocket server", priority: "high", column: 1, assignee: 0 },
  { title: "Write incident response runbook", priority: "medium", column: 0 },
  { title: "Backup restore drill", priority: "medium", column: 3, assignee: 1 },
];

/**
 * Creates an isolated "Acme Engineering" tenant for one reviewer: realistic
 * projects/tasks, four fake teammates (one per role) and some audit history.
 * Each visitor gets their own tenant, so demos never trample each other.
 */
export async function seedDemoWorkspace(conn: DB, ownerUserId: string) {
  const suffix = randomBytes(3).toString("hex");
  return conn.transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: "Acme Engineering", slug: `acme-${suffix}`, isDemo: true })
      .returning();
    const orgId = org!.id;

    const mates = await tx
      .insert(users)
      .values(
        TEAMMATES.map((m) => ({
          name: m.name,
          email: `${m.name.split(" ")[0]!.toLowerCase()}+${suffix}@demo.syncsprint.local`,
          isDemo: true,
        }))
      )
      .returning();

    await tx.insert(orgMembers).values([
      { organizationId: orgId, userId: ownerUserId, role: "owner" },
      ...mates.map((u, i) => ({ organizationId: orgId, userId: u.id, role: TEAMMATES[i]!.role })),
    ]);

    const assignable = [mates[0]!.id, mates[1]!.id, mates[2]!.id];
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

    for (const [p, seedTasks] of [
      [{ name: "Platform Engineering", key: "ENG", description: "Core product & multi-tenant platform" }, ENG_TASKS],
      [{ name: "Operations", key: "OPS", description: "Infra, reliability and security" }, OPS_TASKS],
    ] as const) {
      const [project] = await tx
        .insert(projects)
        .values({ organizationId: orgId, ...p, taskCounter: seedTasks.length })
        .returning();
      const cols = await tx
        .insert(boardColumns)
        .values(DEFAULT_COLUMNS.map((title, i) => ({ organizationId: orgId, projectId: project!.id, title, position: (i + 1) * POSITION_STEP })))
        .returning();

      const perCol = new Map<number, number>();
      const created = await tx
        .insert(tasks)
        .values(
          seedTasks.map((t, i) => {
            const n = (perCol.get(t.column) ?? 0) + 1;
            perCol.set(t.column, n);
            return {
              organizationId: orgId,
              projectId: project!.id,
              columnId: cols[t.column]!.id,
              taskNumber: i + 1,
              title: t.title,
              description: t.description ?? null,
              priority: t.priority,
              assigneeId: t.assignee !== undefined ? assignable[t.assignee]! : null,
              position: n * POSITION_STEP,
              createdAt: minutesAgo(60 * 24 * 3 - i * 30),
              updatedAt: minutesAgo(60 * 24 - i * 20),
            };
          })
        )
        .returning();

      // Some believable history for the activity feed + AI digest.
      await tx.insert(auditLogs).values(
        created
          .filter((_, i) => seedTasks[i]!.column > 0)
          .map((t, i) => ({
            organizationId: orgId,
            actorId: t.assigneeId ?? mates[0]!.id,
            action: "TASK_MOVED",
            entityType: "task",
            entityId: t.id,
            metadata: { targetColumnId: t.columnId, newPosition: t.position, version: 1 },
            createdAt: minutesAgo(240 - i * 15),
          }))
      );
    }

    await tx.insert(auditLogs).values({
      organizationId: orgId,
      actorId: ownerUserId,
      action: "ORG_CREATED",
      entityType: "organization",
      entityId: orgId,
      metadata: { name: "Acme Engineering", demo: true },
      createdAt: minutesAgo(60 * 24 * 3 + 10),
    });
    return org!;
  });
}

async function requireDemoContext(conn: DB, userId: string, organizationId: string) {
  const [row] = await conn
    .select({ orgDemo: organizations.isDemo, userDemo: users.isDemo })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organizationId))
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, userId)))
    .limit(1);
  if (!row) throw new AppError("FORBIDDEN_NOT_A_MEMBER");
  if (!row.orgDemo || !row.userDemo) throw new AppError("FORBIDDEN", "Role switching is only available in demo workspaces");
}

/**
 * Demo-only escape hatch so reviewers can feel each role. It writes the *real*
 * membership row, so every other code path keeps enforcing RBAC normally.
 * A seeded teammate stays owner, so the "last owner" invariant still holds.
 */
export async function switchDemoRole(conn: DB, userId: string, organizationId: string, role: OrgRole) {
  await requireDemoContext(conn, userId, organizationId);
  await conn.transaction(async (tx) => {
    const [prev] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, userId)));
    await tx
      .update(orgMembers)
      .set({ role })
      .where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, userId)));
    await tx.insert(auditLogs).values({
      organizationId,
      actorId: userId,
      action: "MEMBER_ROLE_UPDATED",
      entityType: "member",
      entityId: userId,
      metadata: { from: prev?.role, to: role, demoSwitch: true },
    });
  });
}

/**
 * Makes a seeded teammate move or re-prioritise a random card through the
 * normal service layer (RBAC + OCC + audit), so a lone reviewer can watch
 * real-time sync and conflict handling without a second account.
 */
export async function simulateTeammateActivity(conn: DB, userId: string, organizationId: string, projectId: string) {
  await requireDemoContext(conn, userId, organizationId);

  const mates = await conn
    .select({ id: users.id, name: users.name })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(eq(orgMembers.organizationId, organizationId), ne(orgMembers.userId, userId), eq(users.isDemo, true), ne(orgMembers.role, "viewer")));
  const cols = await conn
    .select()
    .from(boardColumns)
    .where(and(eq(boardColumns.organizationId, organizationId), eq(boardColumns.projectId, projectId)))
    .orderBy(asc(boardColumns.position));
  const all = await conn
    .select()
    .from(tasks)
    .where(and(eq(tasks.organizationId, organizationId), eq(tasks.projectId, projectId)))
    .orderBy(asc(tasks.position));
  if (!mates.length || !all.length || cols.length < 2) throw new AppError("NOT_FOUND", "Nothing to simulate");

  const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
  const mate = pick(mates);
  const task = pick(all);

  if (Math.random() < 0.7) {
    const idx = cols.findIndex((c) => c.id === task.columnId);
    const target = cols[(idx + 1) % cols.length]!;
    const positions = all.filter((t) => t.columnId === target.id && t.id !== task.id).map((t) => t.position);
    const { position } = positionForIndex(positions, 0);
    const res = await moveTask(conn, mate.id, {
      organizationId,
      taskId: task.id,
      targetColumnId: target.id,
      newPosition: position,
      expectedVersion: task.version,
    });
    return { actor: mate, result: res, kind: "moved" as const };
  }
  const priorities: TaskPriority[] = ["low", "medium", "high", "urgent"];
  const res = await updateTask(conn, mate.id, {
    organizationId,
    taskId: task.id,
    expectedVersion: task.version,
    patch: { priority: pick(priorities.filter((p) => p !== task.priority)) },
  });
  return { actor: mate, result: res, kind: "edited" as const };
}
