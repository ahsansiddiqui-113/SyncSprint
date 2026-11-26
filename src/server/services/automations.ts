import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB, DbOrTx } from "@/db";
import {
  auditLogs,
  automationRuns,
  automations,
  boardColumns,
  orgMembers,
  projects,
  tags,
  teams,
  taskComments,
  taskTags,
  tasks,
  type AutomationAction,
  type AutomationCondition,
  type AutomationTrigger,
  type Task,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { POSITION_STEP } from "@/lib/fractional-index";
import { requireOrgPermission } from "@/lib/rbac";
import { notify, taskContext } from "./notifications";

/**
 * Automations ("when X happens, if Y, do Z"), modelled on ClickUp / Jira / Azure rules.
 *
 * Safety rules:
 *  - they run inside the same transaction as the change that triggered them, so a
 *    rolled-back change never leaves half-applied automation effects behind;
 *  - an automation's own changes never trigger other automations (no loops, no cascades);
 *  - every referenced status / person / tag is re-checked at run time; if it no longer
 *    exists the run is recorded as failed and the person's change still goes through.
 */

export const MAX_AUTOMATIONS_PER_PROJECT = 25;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const uuid = z.string().uuid();

export const triggerSchema: z.ZodType<AutomationTrigger> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task_created") }),
  z.object({ kind: z.literal("status_changed"), toColumnId: uuid.nullable() }),
  z.object({ kind: z.literal("assignee_changed") }),
  z.object({ kind: z.literal("priority_changed"), to: z.enum(PRIORITIES).nullable() }),
]);

export const conditionSchema: z.ZodType<AutomationCondition> = z.object({
  field: z.enum(["priority", "type", "assignee", "tag", "team"]),
  op: z.enum(["is", "is_not"]),
  value: z.string().max(60).nullable(),
});

export const actionSchema: z.ZodType<AutomationAction> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move_to_status"), columnId: uuid }),
  z.object({ type: z.literal("set_assignee"), userId: z.union([uuid, z.literal("actor")]).nullable() }),
  z.object({ type: z.literal("set_priority"), priority: z.enum(PRIORITIES) }),
  z.object({ type: z.literal("add_tag"), tagId: uuid }),
  z.object({ type: z.literal("assign_to_team"), teamId: uuid.nullable() }),
  z.object({ type: z.literal("set_due_in_days"), days: z.number().int().min(0).max(365) }),
  z.object({ type: z.literal("add_comment"), body: z.string().trim().min(1).max(1000) }),
  z.object({
    type: z.literal("notify"),
    target: z.enum(["assignee", "watchers", "user"]),
    userId: uuid.nullish(),
    message: z.string().trim().min(1).max(200),
  }),
]);

export const automationInput = z.object({
  name: z.string().trim().min(1, "Name the automation").max(120),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(5).default([]),
  actions: z.array(actionSchema).min(1, "Add at least one action").max(5),
});

/* ------------------------------------ CRUD ------------------------------------ */

async function projectInOrg(conn: DbOrTx, organizationId: string, projectId: string) {
  const [p] = await conn.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
}

/** Everything an automation points at must exist in this project / workspace. */
async function validateRefs(conn: DbOrTx, organizationId: string, projectId: string, a: z.output<typeof automationInput>) {
  const columnIds = [
    ...(a.trigger.kind === "status_changed" && a.trigger.toColumnId ? [a.trigger.toColumnId] : []),
    ...a.actions.flatMap((x) => (x.type === "move_to_status" ? [x.columnId] : [])),
  ];
  const userIds = [
    ...a.actions.flatMap((x) => (x.type === "set_assignee" && x.userId && x.userId !== "actor" ? [x.userId] : x.type === "notify" && x.target === "user" && x.userId ? [x.userId] : [])),
    ...a.conditions.flatMap((c) => (c.field === "assignee" && c.value ? [c.value] : [])),
  ];
  const teamIds = [
    ...a.actions.flatMap((x) => (x.type === "assign_to_team" && x.teamId ? [x.teamId] : [])),
    ...a.conditions.flatMap((c) => (c.field === "team" && c.value ? [c.value] : [])),
  ];
  const tagIds = [
    ...a.actions.flatMap((x) => (x.type === "add_tag" ? [x.tagId] : [])),
    ...a.conditions.flatMap((c) => (c.field === "tag" && c.value ? [c.value] : [])),
  ];
  for (const c of a.conditions) {
    if (c.field === "priority" && !PRIORITIES.includes(c.value as never)) throw new AppError("VALIDATION", "Pick a priority for the condition");
    if (c.field === "type" && !["epic", "story", "task", "bug"].includes(c.value ?? "")) throw new AppError("VALIDATION", "Pick a work item type for the condition");
    if (c.field === "tag" && !c.value) throw new AppError("VALIDATION", "Pick a tag for the condition");
    if (c.field === "team" && c.value && !/^[0-9a-f-]{36}$/i.test(c.value)) throw new AppError("VALIDATION", "Pick a group for the condition");
    if (c.field === "assignee" && c.value && !/^[0-9a-f-]{36}$/i.test(c.value)) throw new AppError("VALIDATION", "Pick a person for the condition");
  }
  for (const x of a.actions) if (x.type === "notify" && x.target === "user" && !x.userId) throw new AppError("VALIDATION", "Pick who to notify");

  if (columnIds.length) {
    const found = await conn.select({ id: boardColumns.id }).from(boardColumns).where(and(eq(boardColumns.projectId, projectId), inArray(boardColumns.id, columnIds)));
    if (found.length !== new Set(columnIds).size) throw new AppError("VALIDATION", "A status in this automation isn't in this project");
  }
  if (userIds.length) {
    const found = await conn.select({ id: orgMembers.userId }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), inArray(orgMembers.userId, userIds)));
    if (found.length !== new Set(userIds).size) throw new AppError("VALIDATION", "Everyone in an automation must be in this workspace");
  }
  if (teamIds.length) {
    const found = await conn.select({ id: teams.id }).from(teams).where(and(eq(teams.organizationId, organizationId), inArray(teams.id, teamIds)));
    if (found.length !== new Set(teamIds).size) throw new AppError("VALIDATION", "A group in this automation doesn't exist");
  }
  if (tagIds.length) {
    const found = await conn.select({ id: tags.id }).from(tags).where(and(eq(tags.organizationId, organizationId), inArray(tags.id, tagIds)));
    if (found.length !== new Set(tagIds).size) throw new AppError("VALIDATION", "A tag in this automation doesn't exist");
  }
}

export async function listAutomations(conn: DB, actorId: string, organizationId: string, projectId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  await projectInOrg(conn, organizationId, projectId);
  return conn
    .select()
    .from(automations)
    .where(and(eq(automations.organizationId, organizationId), eq(automations.projectId, projectId)))
    .orderBy(asc(automations.createdAt));
}

export async function createAutomation(conn: DB, actorId: string, organizationId: string, projectId: string, raw: z.input<typeof automationInput>) {
  const input = automationInput.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    await projectInOrg(tx, organizationId, projectId);
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(automations).where(eq(automations.projectId, projectId))) as [{ n: number }];
    if (n >= MAX_AUTOMATIONS_PER_PROJECT) throw new AppError("VALIDATION", `A project can have up to ${MAX_AUTOMATIONS_PER_PROJECT} automations`);
    await validateRefs(tx, organizationId, projectId, input);
    const [row] = await tx.insert(automations).values({ organizationId, projectId, ...input, createdById: actorId }).returning();
    await tx.insert(auditLogs).values({ organizationId, actorId, action: "AUTOMATION_CREATED", entityType: "automation", entityId: row!.id, metadata: { name: input.name } });
    return row!;
  });
}

export async function updateAutomation(conn: DB, actorId: string, organizationId: string, automationId: string, raw: z.input<typeof automationInput>) {
  const input = automationInput.parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  return conn.transaction(async (tx) => {
    const [cur] = await tx.select().from(automations).where(and(eq(automations.id, automationId), eq(automations.organizationId, organizationId))).limit(1);
    if (!cur) throw new AppError("NOT_FOUND", "Automation not found");
    await validateRefs(tx, organizationId, cur.projectId, input);
    const [row] = await tx.update(automations).set(input).where(eq(automations.id, automationId)).returning();
    await tx.insert(auditLogs).values({ organizationId, actorId, action: "AUTOMATION_UPDATED", entityType: "automation", entityId: automationId, metadata: { name: input.name, enabled: input.enabled } });
    return row!;
  });
}

export async function setAutomationEnabled(conn: DB, actorId: string, organizationId: string, automationId: string, enabled: boolean) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [row] = await conn
    .update(automations)
    .set({ enabled })
    .where(and(eq(automations.id, automationId), eq(automations.organizationId, organizationId)))
    .returning();
  if (!row) throw new AppError("NOT_FOUND", "Automation not found");
  return row;
}

export async function deleteAutomation(conn: DB, actorId: string, organizationId: string, automationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [row] = await conn
    .delete(automations)
    .where(and(eq(automations.id, automationId), eq(automations.organizationId, organizationId)))
    .returning({ name: automations.name, projectId: automations.projectId });
  if (!row) throw new AppError("NOT_FOUND", "Automation not found");
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "AUTOMATION_DELETED", entityType: "automation", entityId: automationId, metadata: { name: row.name } });
  return row;
}

export async function listAutomationRuns(conn: DB, actorId: string, organizationId: string, automationId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  return conn
    .select({ id: automationRuns.id, ok: automationRuns.ok, detail: automationRuns.detail, createdAt: automationRuns.createdAt, taskId: automationRuns.taskId, taskNumber: tasks.taskNumber })
    .from(automationRuns)
    .leftJoin(tasks, eq(tasks.id, automationRuns.taskId))
    .where(and(eq(automationRuns.organizationId, organizationId), eq(automationRuns.automationId, automationId)))
    .orderBy(desc(automationRuns.createdAt))
    .limit(30);
}

/* ----------------------------------- engine ----------------------------------- */

export type TaskChange = { before: Task | null; task: Task };

/** Which triggers does this change fire? (Pure, exported for tests.) */
export function triggerMatches(trigger: AutomationTrigger, change: TaskChange): boolean {
  const { before, task } = change;
  switch (trigger.kind) {
    case "task_created":
      return before === null;
    case "status_changed":
      return !!before && before.columnId !== task.columnId && (trigger.toColumnId === null || trigger.toColumnId === task.columnId);
    case "assignee_changed":
      return !!before && before.assigneeId !== task.assigneeId;
    case "priority_changed":
      return !!before && before.priority !== task.priority && (trigger.to === null || trigger.to === task.priority);
  }
}

async function conditionsHold(tx: DbOrTx, task: Task, conditions: AutomationCondition[]) {
  for (const c of conditions) {
    let actual: boolean;
    if (c.field === "priority") actual = task.priority === c.value;
    else if (c.field === "type") actual = task.type === c.value;
    else if (c.field === "assignee") actual = (task.assigneeId ?? null) === (c.value ?? null);
    else if (c.field === "team") actual = (task.teamId ?? null) === (c.value ?? null);
    else {
      const [hit] = await tx.select({ id: taskTags.tagId }).from(taskTags).where(and(eq(taskTags.taskId, task.id), eq(taskTags.tagId, c.value ?? ""))).limit(1);
      actual = !!hit;
    }
    if (c.op === "is" ? !actual : actual) return false;
  }
  return true;
}

const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Run matching automations for one task change. Returns the task as it ends up.
 * `notified` collects inbox recipients so the caller can ping them after commit.
 */
export async function runAutomations(
  tx: DbOrTx,
  organizationId: string,
  actorId: string,
  change: TaskChange,
  ctx: { today: string; notified: Set<string>; commented?: Set<string>; tagged?: Set<string> }
): Promise<Task> {
  const rules = await tx
    .select()
    .from(automations)
    .where(and(eq(automations.organizationId, organizationId), eq(automations.projectId, change.task.projectId), eq(automations.enabled, true)))
    .orderBy(asc(automations.createdAt));
  let task = change.task;
  for (const rule of rules) {
    if (!triggerMatches(rule.trigger, change)) continue;
    if (!(await conditionsHold(tx, task, rule.conditions))) continue;
    const done: string[] = [];
    let failure: string | null = null;
    const patch: Partial<Task> = {};

    for (const a of rule.actions) {
      if (a.type === "move_to_status") {
        const [col] = await tx.select({ id: boardColumns.id, title: boardColumns.title }).from(boardColumns).where(and(eq(boardColumns.id, a.columnId), eq(boardColumns.projectId, task.projectId))).limit(1);
        if (!col) { failure = "its target status was deleted"; break; }
        if (col.id === (patch.columnId ?? task.columnId)) continue;
        const [last] = await tx.select({ position: tasks.position }).from(tasks).where(eq(tasks.columnId, col.id)).orderBy(desc(tasks.position)).limit(1);
        patch.columnId = col.id;
        patch.position = (last?.position ?? 0) + POSITION_STEP;
        done.push(`moved to ${col.title}`);
      } else if (a.type === "set_assignee") {
        const target = a.userId === "actor" ? actorId : a.userId;
        if (target) {
          const [m] = await tx.select({ id: orgMembers.userId }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, target))).limit(1);
          if (!m) { failure = "the person to assign left the workspace"; break; }
        }
        patch.assigneeId = target ?? null;
        done.push(target ? "assigned" : "unassigned");
      } else if (a.type === "assign_to_team") {
        if (a.teamId) {
          const [tm] = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.id, a.teamId), eq(teams.organizationId, organizationId))).limit(1);
          if (!tm) { failure = "its group was deleted"; break; }
          patch.teamId = tm.id;
          done.push(`sent to ${tm.name}`);
        } else {
          patch.teamId = null;
          done.push("removed from its group");
        }
      } else if (a.type === "set_priority") {
        patch.priority = a.priority;
        done.push(`priority ${a.priority}`);
      } else if (a.type === "set_due_in_days") {
        const due = addDaysIso(ctx.today, a.days);
        patch.dueDate = due;
        const start = patch.startDate !== undefined ? patch.startDate : task.startDate;
        if (start && start > due) patch.startDate = due;
        done.push(`due ${due}`);
      } else if (a.type === "add_tag") {
        const [tg] = await tx.select({ id: tags.id, name: tags.name }).from(tags).where(and(eq(tags.id, a.tagId), eq(tags.organizationId, organizationId))).limit(1);
        if (!tg) { failure = "its tag was deleted"; break; }
        await tx.insert(taskTags).values({ organizationId, taskId: task.id, tagId: tg.id }).onConflictDoNothing();
        ctx.tagged?.add(task.id);
        done.push(`tagged ${tg.name}`);
      } else if (a.type === "add_comment") {
        await tx.insert(taskComments).values({ organizationId, taskId: task.id, authorId: null, automationId: rule.id, body: a.body });
        ctx.commented?.add(task.id);
        done.push("commented");
      } else if (a.type === "notify") {
        const tc = await taskContext(tx, organizationId, task.id);
        if (!tc) continue;
        const assignee = patch.assigneeId !== undefined ? patch.assigneeId : task.assigneeId;
        const recipients =
          a.target === "assignee" ? [assignee, ...tc.coAssignees] : a.target === "watchers" ? tc.watchers : [a.userId ?? null];
        const ids = recipients.filter((u): u is string => !!u);
        // Automations may notify the person who triggered them (it's a rule, not their own action).
        const sent = await notify(
          tx,
          organizationId,
          null,
          ids.map((userId) => ({ userId, kind: "automation" as const, taskId: task.id, title: `${rule.name}: ${tc.ref}`, body: a.message, link: tc.link }))
        );
        sent.forEach((u) => ctx.notified.add(u));
        done.push(`notified ${sent.length}`);
      }
    }

    if (Object.keys(patch).length) {
      const [updated] = await tx
        .update(tasks)
        .set({ ...patch, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
        .where(eq(tasks.id, task.id))
        .returning();
      task = updated!;
    }
    await tx.insert(automationRuns).values({
      organizationId,
      automationId: rule.id,
      taskId: task.id,
      ok: !failure,
      detail: (failure ? `Stopped: ${failure}` : done.join(", ") || "no changes needed").slice(0, 300),
    });
    await tx.update(automations).set({ runCount: sql`${automations.runCount} + 1`, lastRunAt: new Date() }).where(eq(automations.id, rule.id));
    if (!failure && done.length) {
      await tx.insert(auditLogs).values({
        organizationId, actorId, action: "AUTOMATION_RAN", entityType: "task", entityId: task.id, metadata: { automation: rule.name, did: done },
      });
    }
  }
  return task;
}

