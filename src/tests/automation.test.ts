import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { automationRuns, boardColumns, checklistItems, notifications, taskComments, taskRecurrences, taskTags, tasks } from "@/db/schema";
import { createTask, listComments, moveTask, updateTask } from "@/server/services/tasks";
import { addChecklistItem, createTag, setTaskTag } from "@/server/services/breakdown";
import { setCoAssignees } from "@/server/services/customize";
import {
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  setAutomationEnabled,
  triggerMatches,
  updateAutomation,
} from "@/server/services/automations";
import { advanceDate, nextDates, setRecurrence } from "@/server/services/recurrence";
import { newEffects } from "@/server/services/task-effects";
import { addDays } from "@/lib/dates";

// The engine only trusts a "today" within a day of the real date, so dated tests are relative to it.
const TODAY = new Date().toISOString().slice(0, 10);
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";
import type { Task } from "@/db/schema";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;
const col = (i: number) => T.columns[i]!.id;
const DONE = () => T.columns[T.columns.length - 1]!.id;

async function move(task: Task, columnId: string, actor = T.member.id, fx = newEffects()) {
  const fresh = (await getTask(task.id))!;
  const r = await moveTask(db, actor, { organizationId: T.org.id, taskId: task.id, targetColumnId: columnId, newPosition: fresh.position + 1, expectedVersion: fresh.version }, fx);
  if (!r.ok) throw new Error("conflict");
  return r.task;
}
const newTask = (title: string, extra: Record<string, unknown> = {}, fx = newEffects()) =>
  createTask(db, T.member.id, { organizationId: T.org.id, columnId: col(0), title, ...extra }, fx);

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Auto");
  Other = await makeTenant("Elsewhere");
});

describe("trigger matching (pure)", () => {
  const base = { id: "t", columnId: "a", assigneeId: null, priority: "medium" } as unknown as Task;
  it("covers created, status (any or specific), assignee and priority", () => {
    expect(triggerMatches({ kind: "task_created" }, { before: null, task: base })).toBe(true);
    expect(triggerMatches({ kind: "task_created" }, { before: base, task: base })).toBe(false);
    const moved = { ...base, columnId: "b" };
    expect(triggerMatches({ kind: "status_changed", toColumnId: null }, { before: base, task: moved })).toBe(true);
    expect(triggerMatches({ kind: "status_changed", toColumnId: "b" }, { before: base, task: moved })).toBe(true);
    expect(triggerMatches({ kind: "status_changed", toColumnId: "c" }, { before: base, task: moved })).toBe(false);
    expect(triggerMatches({ kind: "assignee_changed" }, { before: base, task: { ...base, assigneeId: "u" } })).toBe(true);
    expect(triggerMatches({ kind: "priority_changed", to: "urgent" }, { before: base, task: { ...base, priority: "high" } })).toBe(false);
    expect(triggerMatches({ kind: "priority_changed", to: "urgent" }, { before: base, task: { ...base, priority: "urgent" } })).toBe(true);
  });
});

describe("automation management", () => {
  it("admins only; every referenced status, person and tag must belong here", async () => {
    const def = { name: "Done → me", trigger: { kind: "status_changed" as const, toColumnId: DONE() }, actions: [{ type: "set_assignee" as const, userId: "actor" as const }] };
    await expect(createAutomation(db, T.member.id, T.org.id, T.project.id, def)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(
      createAutomation(db, T.admin.id, T.org.id, T.project.id, { ...def, trigger: { kind: "status_changed", toColumnId: Other.columns[0]!.id } })
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createAutomation(db, T.admin.id, T.org.id, T.project.id, { ...def, actions: [{ type: "set_assignee", userId: Other.member.id }] })
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createAutomation(db, T.admin.id, T.org.id, T.project.id, { ...def, actions: [] })).rejects.toThrow();
    await expect(createAutomation(db, T.admin.id, T.org.id, Other.project.id, def)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const a = await createAutomation(db, T.admin.id, T.org.id, T.project.id, def);
    await expect(updateAutomation(db, T.admin.id, Other.org.id, a.id, def)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    await deleteAutomation(db, T.admin.id, T.org.id, a.id);
  });
});

describe("automation engine", () => {
  it("status → Done: assign the mover, comment, tag and notify — in the same change", async () => {
    const shipped = await createTag(db, T.admin.id, T.org.id, { name: "Shipped", color: "#0f9d74" });
    const rule = await createAutomation(db, T.admin.id, T.org.id, T.project.id, {
      name: "Wrap up",
      trigger: { kind: "status_changed", toColumnId: DONE() },
      actions: [
        { type: "set_assignee", userId: "actor" },
        { type: "add_tag", tagId: shipped.id },
        { type: "add_comment", body: "Moved to Done. Remember the release notes." },
        { type: "notify", target: "user", userId: T.owner.id, message: "Something shipped" },
      ],
    });
    const t = await newTask("Ship billing");
    const fx = newEffects();
    const done = await move(t, DONE(), T.admin.id, fx);
    expect(done.assigneeId).toBe(T.admin.id);
    expect(done.version).toBe(t.version + 2); // the move + the automation's edit
    expect(await db.select().from(taskTags).where(eq(taskTags.taskId, t.id))).toHaveLength(1);
    const comments = await listComments(db, T.member.id, T.org.id, t.id);
    expect(comments[0]).toMatchObject({ viaAutomation: true, automationName: "Wrap up", authorId: null });
    expect(fx.notified.has(T.owner.id)).toBe(true);
    expect(fx.commented.has(t.id) && fx.tagged.has(t.id)).toBe(true);
    const [run] = await listAutomationRuns(db, T.admin.id, T.org.id, rule.id);
    expect(run).toMatchObject({ ok: true });
    expect(run!.detail).toContain("assigned");
    await deleteAutomation(db, T.admin.id, T.org.id, rule.id);
  });

  it("conditions gate the rule; disabled rules never run", async () => {
    const rule = await createAutomation(db, T.admin.id, T.org.id, T.project.id, {
      name: "Urgent bugs jump the queue",
      trigger: { kind: "task_created" },
      conditions: [
        { field: "type", op: "is", value: "bug" },
        { field: "priority", op: "is", value: "urgent" },
      ],
      actions: [
        { type: "move_to_status", columnId: col(1) },
        { type: "set_due_in_days", days: 1 },
      ],
    });
    const fx = newEffects(TODAY);
    const hit = await newTask("Checkout down", { type: "bug", priority: "urgent" }, fx);
    expect(hit.columnId).toBe(col(1));
    expect(hit.dueDate).toBe(addDays(TODAY, 1));
    const miss = await newTask("Typo", { type: "bug", priority: "low" });
    expect(miss.columnId).toBe(col(0));
    await setAutomationEnabled(db, T.admin.id, T.org.id, rule.id, false);
    expect((await newTask("Down again", { type: "bug", priority: "urgent" })).columnId).toBe(col(0));
    await deleteAutomation(db, T.admin.id, T.org.id, rule.id);
  });

  it("automations don't trigger each other (no loops), but Done side effects still happen", async () => {
    const a = await createAutomation(db, T.admin.id, T.org.id, T.project.id, {
      name: "Review = done", trigger: { kind: "status_changed", toColumnId: col(2) }, actions: [{ type: "move_to_status", columnId: DONE() }],
    });
    const b = await createAutomation(db, T.admin.id, T.org.id, T.project.id, {
      name: "Back to backlog", trigger: { kind: "status_changed", toColumnId: DONE() }, actions: [{ type: "move_to_status", columnId: col(0) }],
    });
    const t = await newTask("Loop bait", { assigneeId: T.admin.id });
    const fx = newEffects();
    const after = await move(t, col(2), T.member.id, fx);
    expect(after.columnId).toBe(DONE()); // A ran; B did not react to A's move
    expect(fx.notified.has(T.admin.id)).toBe(true); // "completed" for the assignee
    expect(await db.select().from(automationRuns).where(eq(automationRuns.automationId, b.id))).toHaveLength(0);
    await deleteAutomation(db, T.admin.id, T.org.id, a.id);
    await deleteAutomation(db, T.admin.id, T.org.id, b.id);
  });

  it("a rule whose target was deleted records a failed run and the person's change still saves", async () => {
    const [extra] = await db.insert(boardColumns).values({ organizationId: T.org.id, projectId: T.project.id, title: "Temp", position: 2500 }).returning();
    const rule = await createAutomation(db, T.admin.id, T.org.id, T.project.id, {
      name: "To temp", trigger: { kind: "priority_changed", to: null }, actions: [{ type: "move_to_status", columnId: extra!.id }],
    });
    await db.delete(boardColumns).where(eq(boardColumns.id, extra!.id));
    const t = await newTask("Prio");
    const r = await updateTask(db, T.member.id, { organizationId: T.org.id, taskId: t.id, expectedVersion: t.version, patch: { priority: "high" } });
    expect(r.ok && r.task.priority).toBe("high");
    const [run] = await listAutomationRuns(db, T.admin.id, T.org.id, rule.id);
    expect(run).toMatchObject({ ok: false });
    expect(run!.detail).toContain("deleted");
    await deleteAutomation(db, T.admin.id, T.org.id, rule.id);
  });

  it("an assignee set by automation gets the 'assigned' notification", async () => {
    const rule = await createAutomation(db, T.admin.id, T.org.id, T.project.id, {
      name: "Triage to Admin", trigger: { kind: "task_created" }, actions: [{ type: "set_assignee", userId: T.admin.id }],
    });
    const t = await newTask("Needs triage");
    const [n] = await db.select().from(notifications).where(and(eq(notifications.taskId, t.id), eq(notifications.userId, T.admin.id)));
    expect(n?.kind).toBe("assigned");
    await deleteAutomation(db, T.admin.id, T.org.id, rule.id);
  });
});

describe("recurring tasks", () => {
  it("date maths: daily, weekdays skip weekends, weekly, monthly clamps to month end", () => {
    expect(advanceDate("2026-11-26", "daily", 2)).toBe("2026-11-28");
    expect(advanceDate("2026-11-27", "weekdays", 1)).toBe("2026-11-30"); // Fri → Mon
    expect(advanceDate("2026-11-26", "weekly", 1)).toBe("2026-12-03");
    expect(advanceDate("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(advanceDate("2028-01-31", "monthly", 1)).toBe("2028-02-29");
    expect(nextDates({ startDate: "2026-11-23", dueDate: "2026-11-26" }, { frequency: "weekly", interval: 1 }, "2026-11-26")).toEqual({ startDate: "2026-11-30", dueDate: "2026-12-03" });
    // Completed long after it was due: skip ahead so the next one isn't already overdue.
    expect(nextDates({ startDate: null, dueDate: "2026-10-01" }, { frequency: "weekly", interval: 1 }, "2026-11-26").dueDate! >= "2026-11-26").toBe(true);
  });

  it("finishing a recurring task creates the next one with people, tags and an unchecked checklist", async () => {
    const tag = await createTag(db, T.admin.id, T.org.id, { name: "Ops", color: "#3f7cb8" });
    const t = await newTask("Weekly report", { assigneeId: T.member.id, dueDate: TODAY, startDate: addDays(TODAY, -2), estimateHours: 2 });
    await setTaskTag(db, T.member.id, T.org.id, t.id, tag.id, true);
    await setCoAssignees(db, T.member.id, T.org.id, t.id, [T.admin.id]);
    const item = await addChecklistItem(db, T.member.id, T.org.id, t.id, "Collect metrics");
    const checked = await db.update(checklistItems).set({ done: true }).where(eq(checklistItems.id, item.item.id)).returning();
    expect(checked).toHaveLength(1); // the source item really is done
    await expect(setRecurrence(db, T.viewer.id, T.org.id, t.id, { frequency: "weekly", interval: 1 })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    await setRecurrence(db, T.member.id, T.org.id, t.id, { frequency: "weekly", interval: 1 });

    const fx = newEffects(TODAY);
    await move(t, DONE(), T.member.id, fx);
    expect(fx.created).toHaveLength(1);
    const next = fx.created[0]!;
    expect(next).toMatchObject({ title: "Weekly report", columnId: col(0), assigneeId: T.member.id, dueDate: addDays(TODAY, 7), startDate: addDays(TODAY, 5), estimateHours: 2 });
    expect(next.taskNumber).toBeGreaterThan(t.taskNumber);
    expect(await db.select().from(taskTags).where(eq(taskTags.taskId, next.id))).toHaveLength(1);
    const items = await db.select().from(checklistItems).where(eq(checklistItems.taskId, next.id));
    expect(items.map((i) => [i.text, i.done])).toEqual([["Collect metrics", false]]);
    const [rule] = await db.select().from(taskRecurrences).where(eq(taskRecurrences.taskId, next.id));
    expect(rule).toMatchObject({ occurrences: 1 });

    // Re-opening and re-completing the old task doesn't duplicate (the rule moved on).
    await move(t, col(1));
    const fx2 = newEffects(TODAY);
    await move(t, DONE(), T.member.id, fx2);
    expect(fx2.created).toHaveLength(0);
  });

  it("rules are tenant-scoped and removable", async () => {
    await expect(setRecurrence(db, T.member.id, T.org.id, Other.task.id, { frequency: "daily", interval: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setRecurrence(db, T.member.id, T.org.id, T.task.id, { frequency: "daily", interval: 13 })).rejects.toThrow();
    await setRecurrence(db, T.member.id, T.org.id, T.task.id, { frequency: "daily", interval: 1 });
    await setRecurrence(db, T.member.id, T.org.id, T.task.id, null);
    expect(await db.select().from(taskRecurrences).where(eq(taskRecurrences.taskId, T.task.id))).toHaveLength(0);
  });
});

void tasks;
void taskComments;
