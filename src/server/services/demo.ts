import { randomBytes } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  auditLogs,
  automations,
  taskRecurrences,
  docTasks,
  docs,
  goals,
  keyResultTasks,
  keyResults,
  notifications,
  timeEntries,
  sprints,
  sprintSnapshots,
  memberCapacity,
  taskAssignees,
  timeOff,
  workSchedules,
  checklistItems,
  tags,
  taskDependencies,
  taskTags,
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
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const POINTS = [1, 2, 3, 5, 8, 3, 5, 2];
    /** Believable schedule per status: backlog in the future, done in the past, one item overdue. */
    const schedule = (column: number, i: number): { startDate: string | null; dueDate: string | null } => {
      if (column === 0) return i % 3 === 2 ? { startDate: null, dueDate: null } : { startDate: day(3 + i), dueDate: day(7 + i * 2) };
      if (column === 1) return { startDate: day(-4 - (i % 3)), dueDate: day((i % 3) - 1) };
      if (column === 2) return { startDate: day(-6), dueDate: day(1 + (i % 2)) };
      return { startDate: day(-14 + i), dueDate: day(-5 + (i % 3)) };
    };

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
              ...schedule(t.column, i),
              storyPoints: POINTS[i % POINTS.length]!,
              // Spread creation across the last ~2 weeks (oldest first) for the dashboard.
              createdAt: minutesAgo(60 * 24 * (13 - i) + 90),
              updatedAt: minutesAgo(60 * 24 * Math.max(0, Math.round((13 - i) * 0.6)) + 45),
            };
          })
        )
        .returning();

      // Believable history for the activity feed, dashboard and AI digest:
      // every task gets a TASK_CREATED at its creation time, and tasks past
      // Backlog get a TASK_MOVED into their column a few days later.
      await tx.insert(auditLogs).values([
        ...created.map((t, i) => ({
          organizationId: orgId,
          actorId: t.assigneeId ?? mates[0]!.id,
          action: "TASK_CREATED",
          entityType: "task",
          entityId: t.id,
          metadata: { ref: `${p.key}-${t.taskNumber}`, title: t.title, columnId: cols[0]!.id },
          createdAt: t.createdAt,
        })),
        ...created
          .map((t, i) => ({ t, i }))
          .filter(({ i }) => seedTasks[i]!.column > 0)
          .map(({ t, i }) => ({
            organizationId: orgId,
            actorId: t.assigneeId ?? mates[0]!.id,
            action: "TASK_MOVED",
            entityType: "task",
            entityId: t.id,
            metadata: { targetColumnId: t.columnId, newPosition: t.position, version: 1 },
            createdAt: minutesAgo(60 * 24 * Math.max(0, Math.round((13 - i) * 0.6)) + 45),
          })),
      ]);

      if (p.key === "ENG") {
        await seedBreakdown(created, project!.id, cols);
        await seedSprints(project!.id, cols);
        await seedCapacity(project!.id, cols);
      }
    }

    /**
     * Phase 3 sample data: work item types, two completed sprints (velocity), an
     * active sprint with a week of daily snapshots (burndown/burnup, including a
     * mid-sprint scope increase) and a planned next sprint.
     */
    /**
     * Workload sample data: hour estimates on open work, a part-time teammate with
     * time off next week, and one person deliberately overloaded this week so the
     * Workload view and capacity warnings have something real to show.
     */
    async function seedCapacity(projectId: string, cols: (typeof boardColumns.$inferSelect)[]) {
      const [sara, alex, priya] = mates;
      await tx.insert(workSchedules).values({ organizationId: orgId, hours: [8, 8, 8, 8, 8, 0, 0], nearThreshold: 85 });
      // Priya: part-time, Mon–Thu 6h (24h/week).
      await tx.insert(memberCapacity).values({ organizationId: orgId, userId: priya!.id, hours: [6, 6, 6, 6, 0, 0, 0] });
      // Priya is on vacation for two days next week.
      const nextMon = (() => {
        const d = new Date();
        const wd = (d.getUTCDay() + 6) % 7;
        return day(7 - wd);
      })();
      const plus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
      await tx.insert(timeOff).values({ organizationId: orgId, userId: priya!.id, kind: "vacation", startDate: plus(nextMon, 1), endDate: plus(nextMon, 2), note: "Family trip" });

      const open = (await tx.select().from(tasks).where(eq(tasks.projectId, projectId))).filter((t) => t.columnId !== cols[cols.length - 1]!.id);
      for (const t of open) {
        // ~1.5h per story point, rounded to the half hour.
        const est = Math.max(1, Math.round((t.storyPoints ?? 2) * 1.5 * 2) / 2);
        await tx.update(tasks).set({ estimateHours: est }).where(eq(tasks.id, t.id));
      }
      // Alex is overloaded this week: a big task due in 2 days on top of their sprint work.
      const [counter] = await tx.update(projects).set({ taskCounter: sql`${projects.taskCounter} + 1` }).where(eq(projects.id, projectId)).returning({ n: projects.taskCounter });
      const [big] = await tx
        .insert(tasks)
        .values({
          organizationId: orgId, projectId, columnId: cols[1]!.id, taskNumber: counter!.n, title: "Migrate billing data to the new schema",
          priority: "high", type: "story", assigneeId: alex!.id, estimateHours: 24, storyPoints: 8, startDate: day(0), dueDate: day(2),
          position: 95 * POSITION_STEP, createdAt: minutesAgo(60 * 3), updatedAt: minutesAgo(60 * 3),
        })
        .returning();
      // Shared work: Sara pairs with Alex on SSO (the estimate is split between them).
      const sso = open.find((t) => t.title.startsWith("SSO"));
      if (sso) await tx.insert(taskAssignees).values({ organizationId: orgId, taskId: sso.id, userId: sara!.id });
      await tx.insert(auditLogs).values({
        organizationId: orgId, actorId: sara!.id, action: "TASK_CREATED", entityType: "task", entityId: big!.id,
        metadata: { ref: `ENG-${counter!.n}`, title: big!.title, columnId: cols[1]!.id }, createdAt: minutesAgo(60 * 3),
      });
    }

    async function seedSprints(projectId: string, cols: (typeof boardColumns.$inferSelect)[]) {
      const all = await tx.select().from(tasks).where(eq(tasks.projectId, projectId));
      const byNumber = (n: number) => all.find((t) => t.taskNumber === n);
      const TYPES: Record<number, "epic" | "story" | "task" | "bug"> = {
        1: "epic", 2: "story", 3: "task", 4: "story", 5: "bug", 6: "epic", 7: "story", 8: "story", 9: "bug", 10: "task", 11: "task", 12: "story",
      };
      for (const [n, type] of Object.entries(TYPES)) {
        const t = byNumber(Number(n));
        if (t) await tx.update(tasks).set({ type }).where(eq(tasks.id, t.id));
      }

      const doneCol = cols[cols.length - 1]!.id;
      const [s1, s2, s3, s4] = await tx
        .insert(sprints)
        .values([
          { organizationId: orgId, projectId, name: "Sprint 1", goal: "Ship workspace onboarding", startDate: day(-42), endDate: day(-29), status: "completed", committedPoints: 21, completedPoints: 18, startedAt: minutesAgo(60 * 24 * 42), completedAt: minutesAgo(60 * 24 * 29) },
          { organizationId: orgId, projectId, name: "Sprint 2", goal: "Roles, invites and the activity log", startDate: day(-28), endDate: day(-15), status: "completed", committedPoints: 24, completedPoints: 22, startedAt: minutesAgo(60 * 24 * 28), completedAt: minutesAgo(60 * 24 * 15) },
          { organizationId: orgId, projectId, name: "Sprint 3", goal: "Faster boards and enterprise sign-in", startDate: day(-6), endDate: day(7), status: "active", startedAt: minutesAgo(60 * 24 * 6) },
          { organizationId: orgId, projectId, name: "Sprint 4", goal: "Billing and API hardening", startDate: day(8), endDate: day(21), status: "planned" },
        ])
        .returning();

      // Active sprint: everything past Backlog plus the billing subtasks. Planned: two backlog stories.
      const activeTasks = all.filter((t) => t.columnId !== cols[0]!.id || t.parentId);
      for (const t of activeTasks) await tx.update(tasks).set({ sprintId: s3!.id }).where(eq(tasks.id, t.id));
      for (const n of [2, 4]) {
        const t = byNumber(n);
        if (t) await tx.update(tasks).set({ sprintId: s4!.id }).where(eq(tasks.id, t.id));
      }

      const scopeNow = activeTasks.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
      const doneNow = activeTasks.filter((t) => t.columnId === doneCol).reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
      const tasksNow = activeTasks.length;
      const doneTasksNow = activeTasks.filter((t) => t.columnId === doneCol).length;
      const creep = 3; // a 3-pointer joined on day 3
      await tx.update(sprints).set({ committedPoints: scopeNow - creep }).where(eq(sprints.id, s3!.id));

      const progress = [0, 0.15, 0.3, 0.35, 0.55, 0.8, 1]; // uneven, like real teams
      await tx.insert(sprintSnapshots).values(
        progress.map((f, i) => ({
          organizationId: orgId,
          sprintId: s3!.id,
          day: day(i - 6),
          scopePoints: i >= 3 ? scopeNow : scopeNow - creep,
          completedPoints: Math.round(doneNow * f),
          scopeTasks: i >= 3 ? tasksNow : tasksNow - 1,
          completedTasks: Math.round(doneTasksNow * f),
        }))
      );
      // Historical sprints: start + end snapshots so their burndown has a shape.
      for (const [sp, committed, completed, start, end] of [
        [s1!, 21, 18, -42, -29],
        [s2!, 24, 22, -28, -15],
      ] as const) {
        await tx.insert(sprintSnapshots).values([
          { organizationId: orgId, sprintId: sp.id, day: day(start), scopePoints: committed, completedPoints: 0, scopeTasks: 8, completedTasks: 0 },
          { organizationId: orgId, sprintId: sp.id, day: day(start + 7), scopePoints: committed, completedPoints: Math.round(completed * 0.45), scopeTasks: 8, completedTasks: 3 },
          { organizationId: orgId, sprintId: sp.id, day: day(end), scopePoints: committed, completedPoints: completed, scopeTasks: 8, completedTasks: 7 },
        ]);
      }
      await tx.insert(auditLogs).values([
        { organizationId: orgId, actorId: mates[0]!.id, action: "SPRINT_COMPLETED", entityType: "sprint", entityId: s2!.id, metadata: { name: "Sprint 2", committedPoints: 24, completedPoints: 22, carriedOver: 1 }, createdAt: minutesAgo(60 * 24 * 15) },
        { organizationId: orgId, actorId: mates[0]!.id, action: "SPRINT_STARTED", entityType: "sprint", entityId: s3!.id, metadata: { name: "Sprint 3", committedPoints: scopeNow - creep }, createdAt: minutesAgo(60 * 24 * 6) },
      ]);
    }

    /** Phase 5 sample data: inbox, logged time, a linked doc and a goal. */
    async function seedCollaboration(eng: (typeof tasks.$inferSelect)[], projectId: string, billing: typeof tasks.$inferSelect) {
      const [sara, alex, priya] = [mates[0]!, mates[1]!, mates[2]!];
      const byNumber = (n: number) => eng.find((t) => t.taskNumber === n)!;
      const link = (t: { id: string }) => `/w/${org!.slug}/projects/ENG?task=${t.id}`;
      const ref = (t: { taskNumber: number }) => `ENG-${t.taskNumber}`;
      const t5 = byNumber(5);
      const t8 = byNumber(8);

      await tx.insert(notifications).values([
        { organizationId: orgId, userId: ownerUserId, actorId: alex.id, kind: "mention", taskId: billing.id, title: `${alex.name} mentioned you on ${ref(billing)}`, body: "@You can you review the retry policy before we ship? Dead-letter queue is wired up.", link: link(billing), createdAt: minutesAgo(18) },
        { organizationId: orgId, userId: ownerUserId, actorId: sara.id, kind: "assigned", taskId: t8.id, title: `${sara.name} assigned you ${ref(t8)}`, body: t8.title, link: link(t8), createdAt: minutesAgo(95) },
        { organizationId: orgId, userId: ownerUserId, actorId: priya.id, kind: "comment", taskId: t5.id, title: `${priya.name} commented on ${ref(t5)}`, body: "Pushed the fix to staging — p95 is back under 200ms.", link: link(t5), createdAt: minutesAgo(60 * 5) },
        { organizationId: orgId, userId: ownerUserId, actorId: null, kind: "capacity", taskId: null, title: `${alex.name} is over capacity`, body: "11.5h of 8h today. Consider rebalancing their work.", link: `/w/${org!.slug}/projects/ENG?view=workload`, dedupeKey: `capacity:${alex.id}:${day(0)}`, createdAt: minutesAgo(60 * 7) },
        { organizationId: orgId, userId: ownerUserId, actorId: priya.id, kind: "completed", taskId: billing.id, title: `${priya.name} completed Design webhook event schema`, body: "Subtask of " + billing.title, link: link(billing), createdAt: minutesAgo(60 * 26), readAt: minutesAgo(60 * 20) },
      ]);

      const entry = (t: { id: string }, userId: string, daysAgo: number, minutes: number, note: string | null) => {
        const startedAt = new Date(`${day(-daysAgo)}T09:00:00Z`);
        return { organizationId: orgId, taskId: t.id, userId, startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000), minutes, note, manual: true };
      };
      await tx.insert(timeEntries).values([
        entry(billing, alex.id, 3, 40, "Signature verification + tests"),
        entry(billing, alex.id, 2, 25, "Idempotency keys"),
        entry(billing, priya.id, 1, 20, "Pairing on retries"),
        entry(t5, priya.id, 1, 240, null),
        entry(t5, priya.id, 0, 120, "Profiling the hot path"),
        entry(t8, sara.id, 2, 60, "Review"),
      ]);

      const [runbook, plan] = await tx
        .insert(docs)
        .values([
          {
            organizationId: orgId, title: "Billing webhooks runbook", createdById: alex.id, updatedById: alex.id, version: 3, updatedAt: minutesAgo(60 * 3),
            content: [
              "# Billing webhooks runbook", "",
              "How we receive, verify and process payment events.", "",
              "## Checklist before shipping", "",
              "- [x] Verify webhook signatures", "- [ ] Idempotent handler (dedupe on event id)", "- [ ] Retries with a dead-letter queue", "",
              "## When events fail", "",
              "| Symptom | First check | Owner |", "| --- | --- | --- |",
              "| 4xx from handler | Signature secret rotated? | Platform |", "| Duplicate invoices | Idempotency key missing | Platform |", "",
              "> Never replay events by hand in production — use the dead-letter queue.",
            ].join("\n"),
          },
          {
            organizationId: orgId, title: "Q4 engineering plan", createdById: sara.id, updatedById: sara.id, version: 5, updatedAt: minutesAgo(60 * 30),
            content: "# Q4 engineering plan\n\n## Themes\n\n1. **Self-serve billing** so teams can upgrade without talking to sales\n2. **Reliability**: p95 under 200ms on every board action\n3. **Security review** ahead of the SOC 2 audit\n\n## Not this quarter\n\n- Mobile apps\n- Public API v2\n",
          },
        ])
        .returning();
      await tx.insert(docTasks).values([
        { organizationId: orgId, docId: runbook!.id, taskId: billing.id },
        { organizationId: orgId, docId: plan!.id, taskId: t5.id },
      ]);

      const [goal] = await tx
        .insert(goals)
        .values({ organizationId: orgId, title: "Launch self-serve billing", description: "Teams can upgrade and pay without contacting sales.", ownerId: sara.id, dueDate: day(40) })
        .returning();
      const [paying, shipped] = await tx
        .insert(keyResults)
        .values([
          { organizationId: orgId, goalId: goal!.id, title: "Paying workspaces", kind: "number", startValue: 0, targetValue: 50, currentValue: 18, unit: "workspaces", position: POSITION_STEP },
          { organizationId: orgId, goalId: goal!.id, title: "Ship the billing integration", kind: "tasks", position: 2 * POSITION_STEP },
        ])
        .returning();
      const subtasks = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.parentId, billing.id));
      await tx.insert(keyResultTasks).values([billing, ...subtasks].map((t) => ({ organizationId: orgId, keyResultId: shipped!.id, taskId: t.id })));
      void paying;

      const [reliability] = await tx
        .insert(goals)
        .values({ organizationId: orgId, title: "Make every board action feel instant", ownerId: alex.id, dueDate: day(70) })
        .returning();
      await tx.insert(keyResults).values([
        { organizationId: orgId, goalId: reliability!.id, title: "p95 latency of board moves", kind: "number", startValue: 480, targetValue: 200, currentValue: 260, unit: "ms", position: POSITION_STEP },
      ]);
      // Phase 6: two automations and a recurring chore.
      const engCols = await tx.select({ id: boardColumns.id, title: boardColumns.title }).from(boardColumns).where(eq(boardColumns.projectId, projectId)).orderBy(asc(boardColumns.position));
      const doneCol = engCols[engCols.length - 1]!;
      const progressCol = engCols[1]!;
      await tx.insert(automations).values([
        {
          organizationId: orgId, projectId, name: "Assign on start", createdById: sara.id, runCount: 7, lastRunAt: minutesAgo(60 * 3),
          trigger: { kind: "status_changed", toColumnId: progressCol.id }, conditions: [{ field: "assignee", op: "is", value: null }],
          actions: [{ type: "set_assignee", userId: "actor" }],
        },
        {
          organizationId: orgId, projectId, name: "Urgent bugs first", createdById: alex.id, runCount: 2, lastRunAt: minutesAgo(60 * 26),
          trigger: { kind: "task_created" },
          conditions: [{ field: "type", op: "is", value: "bug" }, { field: "priority", op: "is", value: "urgent" }],
          actions: [{ type: "move_to_status", columnId: progressCol.id }, { type: "set_due_in_days", days: 1 }, { type: "notify", target: "user", userId: alex.id, message: "Urgent bug — please take a look today." }],
        },
        {
          organizationId: orgId, projectId, name: "Done → watchers", createdById: sara.id, enabled: false,
          trigger: { kind: "status_changed", toColumnId: doneCol.id }, conditions: [],
          actions: [{ type: "notify", target: "watchers", message: "This is done. Check it out." }],
        },
      ]);
      const [chore] = await tx
        .update(projects)
        .set({ taskCounter: sql`${projects.taskCounter} + 1` })
        .where(eq(projects.id, projectId))
        .returning({ n: projects.taskCounter });
      const [weekly] = await tx
        .insert(tasks)
        .values({
          organizationId: orgId, projectId, columnId: engCols[0]!.id, taskNumber: chore!.n, title: "Weekly dependency updates", priority: "low", type: "task",
          assigneeId: priya.id, estimateHours: 1.5, dueDate: day(4), position: 95 * POSITION_STEP, createdAt: minutesAgo(60 * 24 * 20), updatedAt: minutesAgo(60 * 24),
        })
        .returning();
      await tx.insert(taskRecurrences).values({ taskId: weekly!.id, organizationId: orgId, frequency: "weekly", interval: 1, occurrences: 3, createdById: priya.id });
      void projectId;
    }

    /** Phase 2 sample data: tags, a checklist, subtasks and dependencies on the ENG board. */
    async function seedBreakdown(eng: (typeof tasks.$inferSelect)[], projectId: string, cols: (typeof boardColumns.$inferSelect)[]) {
      const byNumber = (n: number) => eng.find((t) => t.taskNumber === n)!;
      const tagRows = await tx
        .insert(tags)
        .values([
          { organizationId: orgId, name: "Backend", color: "#3f7cb8" },
          { organizationId: orgId, name: "Frontend", color: "#e44a8a" },
          { organizationId: orgId, name: "Security", color: "#dd6b00" },
          { organizationId: orgId, name: "Customer", color: "#0f9d74" },
        ])
        .returning();
      const tag = (name: string) => tagRows.find((t) => t.name === name)!.id;
      await tx.insert(taskTags).values(
        (
          [
            [1, "Backend"], [1, "Customer"], [2, "Backend"], [4, "Backend"], [5, "Backend"], [5, "Customer"],
            [6, "Security"], [7, "Frontend"], [8, "Security"], [8, "Backend"], [9, "Security"], [11, "Frontend"],
          ] as const
        ).map(([n, name]) => ({ organizationId: orgId, taskId: byNumber(n).id, tagId: tag(name) }))
      );

      // Checklist on the billing webhook task.
      const billing = byNumber(1);
      await tx.insert(checklistItems).values(
        ["Verify webhook signatures", "Make handler idempotent", "Map Stripe customers to workspaces", "Add retry + dead-letter queue"].map((text, i) => ({
          organizationId: orgId,
          taskId: billing.id,
          text,
          done: i === 0,
          position: (i + 1) * POSITION_STEP,
        }))
      );

      // Two subtasks under the billing webhook (one already done).
      const [counter] = await tx
        .update(projects)
        .set({ taskCounter: eng.length + 2 })
        .where(eq(projects.id, projectId))
        .returning({ n: projects.taskCounter });
      await tx.insert(tasks).values([
        {
          organizationId: orgId, projectId, columnId: cols[cols.length - 1]!.id, parentId: billing.id,
          taskNumber: counter!.n - 1, title: "Design webhook event schema", priority: "medium", position: 90 * POSITION_STEP,
          assigneeId: billing.assigneeId, storyPoints: 2, createdAt: minutesAgo(60 * 24 * 6), updatedAt: minutesAgo(60 * 24 * 2),
        },
        {
          organizationId: orgId, projectId, columnId: cols[1]!.id, parentId: billing.id,
          taskNumber: counter!.n, title: "Handle invoice.paid events", priority: "high", position: 90 * POSITION_STEP,
          assigneeId: billing.assigneeId, storyPoints: 3, createdAt: minutesAgo(60 * 24 * 5), updatedAt: minutesAgo(60 * 24),
        },
      ]);

      // ENG-5 (in progress) blocks ENG-1; ENG-8 (review) blocks ENG-6.
      await tx.insert(taskDependencies).values([
        { organizationId: orgId, blockerId: byNumber(5).id, blockedId: billing.id },
        { organizationId: orgId, blockerId: byNumber(8).id, blockedId: byNumber(6).id },
      ]);
      await seedCollaboration(eng, projectId, billing);
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
