import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { automationFires, organizations, taskDependencies, tasks, whiteboardItems } from "@/db/schema";
import { criticalPath, durationOf, workingDays, workingOffset } from "@/lib/critical-path";
import { createBaseline, deleteBaseline, getBaseline, listBaselines } from "@/server/services/baselines";
import { getPortfolio, projectHealth, setProjectStatus } from "@/server/services/portfolio";
import { createAutomation } from "@/server/services/automations";
import { acquireLease, localParts, releaseLease, runScheduledAutomations, scheduleOccasion } from "@/server/services/scheduler";
import { applyBoardOps, convertItemToTask, createBoard, deleteBoard, getBoard, listBoards, mindmapBranchToTasks } from "@/server/services/whiteboards";
import { createTask, updateTask } from "@/server/services/tasks";
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;
const DAY = 86_400_000;
const isoIn = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Visual");
  Other = await makeTenant("Elsewhere");
});

/* -------------------------------- critical path -------------------------------- */

describe("critical path (pure)", () => {
  it("counts working days and offsets, skipping weekends", () => {
    expect(workingDays("2026-11-23", "2026-11-27")).toBe(5); // Mon–Fri
    expect(workingDays("2026-11-27", "2026-11-30")).toBe(2); // Fri + Mon
    expect(workingDays("2026-11-28", "2026-11-29")).toBe(1); // weekend-only task still counts as a day
    expect(workingOffset("2026-11-23", "2026-11-30")).toBe(5);
    expect(workingOffset("2026-11-30", "2026-11-23")).toBe(-5);
    expect(durationOf({ id: "a", startDate: null, dueDate: null, estimateHours: 20, done: false })).toBe(3);
  });

  it("finds the chain that sets the end date and the slack everywhere else", () => {
    const t = (id: string, s: string, e: string, done = false) => ({ id, startDate: s, dueDate: e, estimateHours: null, done });
    // A(3d) → B(5d) → D(2d) is the long chain; C(1d) only feeds D, so it has slack. E is finished.
    const tasks = [t("A", "2026-11-23", "2026-11-25"), t("B", "2026-11-23", "2026-11-27"), t("C", "2026-11-23", "2026-11-23"), t("D", "2026-11-23", "2026-11-24"), t("E", "2026-11-01", "2026-11-02", true)];
    const deps = [
      { blockerId: "A", blockedId: "B" },
      { blockerId: "B", blockedId: "D" },
      { blockerId: "C", blockedId: "D" },
      { blockerId: "E", blockedId: "A" }, // finished work imposes nothing
    ];
    const r = criticalPath(tasks, deps, "2026-11-23");
    expect(r.chain).toEqual(["A", "B", "D"]);
    expect(r.length).toBe(10);
    expect(r.slack.get("C")).toBe(7);
    expect(r.critical.has("E")).toBe(false);
    // A cycle (prevented on write) is ignored instead of hanging.
    const cyc = criticalPath([t("X", "2026-11-23", "2026-11-23"), t("Y", "2026-11-23", "2026-11-23")], [{ blockerId: "X", blockedId: "Y" }, { blockerId: "Y", blockedId: "X" }], "2026-11-23");
    expect(cyc.chain).toEqual([]);
  });
});

/* ---------------------------------- baselines ---------------------------------- */

describe("baselines", () => {
  it("admins save a frozen copy of the dates; slip shows how far due dates moved", async () => {
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Dated", startDate: "2026-12-01", dueDate: "2026-12-05" });
    await expect(createBaseline(db, T.member.id, T.org.id, T.project.id, "Plan")).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(createBaseline(db, T.admin.id, T.org.id, Other.project.id, "Theirs")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const b = await createBaseline(db, T.admin.id, T.org.id, T.project.id, "Plan v1");
    expect(b.tasks).toBeGreaterThanOrEqual(1);
    await updateTask(db, T.member.id, { organizationId: T.org.id, taskId: t.id, expectedVersion: t.version, patch: { dueDate: "2026-12-08" } });
    const got = await getBaseline(db, T.viewer.id, T.org.id, b.id);
    expect(got.tasks.find((x) => x.taskId === t.id)).toMatchObject({ dueDate: "2026-12-05", slipDays: 3 });
    expect((await listBaselines(db, T.viewer.id, T.org.id, T.project.id)).map((x) => x.name)).toContain("Plan v1");
    await expect(getBaseline(db, Other.owner.id, Other.org.id, b.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteBaseline(db, T.admin.id, T.org.id, b.id);
    expect(await listBaselines(db, T.admin.id, T.org.id, T.project.id)).toHaveLength(0);
  });
});

/* ---------------------------------- portfolio ---------------------------------- */

describe("portfolio", () => {
  it("health rules", () => {
    const today = "2026-11-26";
    expect(projectHealth({ total: 0, done: 0, overdue: 0, start: null, end: null }, today).health).toBe("not_started");
    expect(projectHealth({ total: 4, done: 4, overdue: 0, start: "2026-11-01", end: "2026-11-20" }, today).health).toBe("done");
    expect(projectHealth({ total: 4, done: 2, overdue: 0, start: "2026-11-01", end: "2026-11-20" }, today).health).toBe("late");
    expect(projectHealth({ total: 4, done: 1, overdue: 1, start: "2026-11-01", end: "2026-12-30" }, today).health).toBe("at_risk");
    // 43% of the time gone, 0% done → more than 20 points behind
    expect(projectHealth({ total: 10, done: 0, overdue: 0, start: "2026-11-01", end: "2026-12-30" }, today).health).toBe("at_risk");
    expect(projectHealth({ total: 10, done: 4, overdue: 0, start: "2026-11-01", end: "2026-12-30" }, today).health).toBe("on_track");
  });

  it("lists every project with counts; admins post status updates", async () => {
    const p = await getPortfolio(db, T.viewer.id, T.org.id, new Date().toISOString().slice(0, 10));
    const eng = p.projects.find((x) => x.key === "ENG")!;
    expect(eng.total).toBeGreaterThan(0);
    expect(eng.open + eng.done).toBe(eng.total);
    await expect(setProjectStatus(db, T.member.id, T.org.id, T.project.id, { status: "at_risk" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await setProjectStatus(db, T.admin.id, T.org.id, T.project.id, { status: "at_risk", note: "Waiting on the payments vendor" });
    const again = await getPortfolio(db, T.viewer.id, T.org.id);
    expect(again.projects.find((x) => x.key === "ENG")!.status).toMatchObject({ value: "at_risk", note: "Waiting on the payments vendor" });
    expect((await getPortfolio(db, Other.owner.id, Other.org.id)).projects.every((x) => x.id !== T.project.id)).toBe(true);
  });
});

/* ------------------------------ scheduled automations ------------------------------ */

describe("scheduled automations", () => {
  it("time zone maths for schedules", () => {
    const now = new Date("2026-11-26T04:30:00Z"); // Thursday 09:30 in Karachi (UTC+5)
    expect(localParts(now, "Asia/Karachi")).toEqual({ date: "2026-11-26", hour: 9, weekday: 3 });
    expect(scheduleOccasion({ kind: "schedule", every: "day", hour: 9, timezone: "Asia/Karachi" }, now)).toBe("2026-11-26");
    expect(scheduleOccasion({ kind: "schedule", every: "day", hour: 10, timezone: "Asia/Karachi" }, now)).toBeNull();
    expect(scheduleOccasion({ kind: "schedule", every: "week", weekday: 0, hour: 9, timezone: "Asia/Karachi" }, now)).toBeNull();
    expect(scheduleOccasion({ kind: "schedule", every: "weekday", hour: 9, timezone: "Asia/Karachi" }, new Date("2026-11-28T06:00:00Z"))).toBeNull(); // Saturday
  });

  it("due soon and overdue fire once per task; conditions apply; nothing fires twice", async () => {
    const soon = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Due tomorrow", dueDate: isoIn(1), priority: "high" });
    const late = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Was due", dueDate: isoIn(-2) });
    const lowSoon = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Low, due tomorrow", dueDate: isoIn(1), priority: "low" });
    const a = await createAutomation(db, T.admin.id, T.org.id, T.project.id, {
      name: "Heads-up", trigger: { kind: "due_soon", days: 2 }, conditions: [{ field: "priority", op: "is", value: "high" }],
      actions: [{ type: "notify", target: "user", userId: T.admin.id, message: "Due soon" }, { type: "set_priority", priority: "urgent" }],
    });
    const b = await createAutomation(db, T.admin.id, T.org.id, T.project.id, {
      name: "Overdue to Review", trigger: { kind: "overdue" }, actions: [{ type: "move_to_status", columnId: T.columns[2]!.id }],
    });
    const r1 = await runScheduledAutomations(db);
    expect(r1.changes.map((c) => c.task.id)).toEqual(expect.arrayContaining([soon.id, late.id]));
    expect(r1.changes.find((c) => c.task.id === lowSoon.id)).toBeUndefined();
    expect((await getTask(soon.id))!.priority).toBe("urgent");
    expect((await getTask(late.id))!.columnId).toBe(T.columns[2]!.id);
    expect(r1.changes.find((c) => c.task.id === soon.id)!.notified).toEqual([T.admin.id]);
    const r2 = await runScheduledAutomations(db);
    expect(r2.changes.filter((c) => [soon.id, late.id].includes(c.task.id))).toHaveLength(0);
    const fires = await db.select().from(automationFires).where(eq(automationFires.automationId, a.id));
    expect(fires.map((f) => f.occasion)).toEqual([`due:${isoIn(1)}`]);
    void b;
  });

  it("schedule rules run once per occurrence; scheduled rules can't 'assign the person who made the change'", async () => {
    await expect(
      createAutomation(db, T.admin.id, T.org.id, T.project.id, { name: "bad", trigger: { kind: "schedule", every: "day", hour: 0, timezone: "UTC" }, actions: [{ type: "set_assignee", userId: "actor" }] })
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createAutomation(db, T.admin.id, T.org.id, T.project.id, { name: "bad tz", trigger: { kind: "schedule", every: "day", hour: 0, timezone: "Mars/Olympus" }, actions: [{ type: "set_priority", priority: "low" }] })
    ).rejects.toThrow();
    const daily = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[1]!.id, title: "In progress, standup" });
    await createAutomation(db, T.admin.id, T.org.id, T.project.id, {
      name: "Daily nudge", trigger: { kind: "schedule", every: "day", hour: 0, timezone: "UTC" },
      conditions: [{ field: "status", op: "is", value: T.columns[1]!.id }], actions: [{ type: "add_comment", body: "Daily check-in: still on track?" }],
    });
    const r1 = await runScheduledAutomations(db);
    expect(r1.changes.some((c) => c.task.id === daily.id && c.commented)).toBe(true);
    const r2 = await runScheduledAutomations(db);
    expect(r2.changes.some((c) => c.task.id === daily.id && c.commented)).toBe(false);
  });

  it("pauses while a workspace is read-only for billing", async () => {
    const W = await makeTenant("Paused");
    await createTask(db, W.member.id, { organizationId: W.org.id, columnId: W.columns[0]!.id, title: "Late", dueDate: isoIn(-1) });
    await createAutomation(db, W.admin.id, W.org.id, W.project.id, { name: "Late", trigger: { kind: "overdue" }, actions: [{ type: "set_priority", priority: "urgent" }] });
    await db.update(organizations).set({ trialEndsAt: new Date(Date.now() - DAY) }).where(eq(organizations.id, W.org.id));
    const r = await runScheduledAutomations(db);
    expect(r.changes.some((c) => c.organizationId === W.org.id)).toBe(false);
  });

  it("the lease lets only one runner in at a time", async () => {
    expect(await acquireLease(db, "test-lease", 60_000)).toBe(true);
    expect(await acquireLease(db, "test-lease", 60_000)).toBe(false);
    await releaseLease(db, "test-lease", new Date(Date.now() - 1000));
    expect(await acquireLease(db, "test-lease", 60_000)).toBe(true);
  });
});

/* ------------------------------ whiteboards & mind maps ------------------------------ */

describe("whiteboards", () => {
  it("members create boards; items with arrows; stale drags are reported, not overwritten; deletes cascade", async () => {
    await expect(createBoard(db, T.viewer.id, T.org.id, T.project.id, { name: "x", kind: "whiteboard" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    const b = await createBoard(db, T.member.id, T.org.id, T.project.id, { name: "Launch ideas", kind: "whiteboard" });
    const r1 = await applyBoardOps(db, T.member.id, T.org.id, b.id, [
      { op: "create", kind: "note", fields: { x: 0, y: 0, text: "Pricing page\nCompare plans" } },
      { op: "create", kind: "note", fields: { x: 300, y: 0, text: "Launch email" } },
    ]);
    const [n1, n2] = r1.changed;
    const r2 = await applyBoardOps(db, T.member.id, T.org.id, b.id, [{ op: "create", kind: "arrow", fields: { fromId: n1!.id, toId: n2!.id } }]);
    expect(r2.revision).toBeGreaterThan(r1.revision);
    await expect(applyBoardOps(db, T.member.id, T.org.id, b.id, [{ op: "create", kind: "arrow", fields: { fromId: n1!.id } }])).rejects.toMatchObject({ code: "VALIDATION" });

    // Two people drag the same note: the second (stale version) gets a conflict.
    const a = await applyBoardOps(db, T.member.id, T.org.id, b.id, [{ op: "update", id: n1!.id, version: n1!.version, fields: { x: 50 } }]);
    expect(a.changed[0]!.x).toBe(50);
    const stale = await applyBoardOps(db, T.admin.id, T.org.id, b.id, [{ op: "update", id: n1!.id, version: n1!.version, fields: { x: 999 } }]);
    expect(stale.conflicts[0]!.x).toBe(50);

    const del = await applyBoardOps(db, T.member.id, T.org.id, b.id, [{ op: "delete", id: n2!.id }]);
    expect(del.deleted).toContain(n2!.id);
    const after = await getBoard(db, T.viewer.id, T.org.id, b.id);
    expect(after.items.map((i) => i.kind)).toEqual(["note"]); // the arrow went with it
    await expect(getBoard(db, Other.owner.id, Other.org.id, b.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(applyBoardOps(db, T.member.id, T.org.id, b.id, [{ op: "create", kind: "task", fields: { taskId: Other.task.id } }])).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { task } = await convertItemToTask(db, T.member.id, T.org.id, n1!.id);
    expect(task).toMatchObject({ title: "Pricing page", description: "Compare plans" });
    expect((await getBoard(db, T.viewer.id, T.org.id, b.id)).tasks.map((t) => t.id)).toEqual([task.id]);
    await expect(convertItemToTask(db, T.member.id, T.org.id, n1!.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(deleteBoard(db, T.viewer.id, T.org.id, b.id)).rejects.toThrow();
    await deleteBoard(db, T.admin.id, T.org.id, b.id);
    expect((await listBoards(db, T.member.id, T.org.id, T.project.id)).find((x) => x.id === b.id)).toBeUndefined();
  });

  it("mind map: a branch becomes a task with subtasks; running it again adds only new ideas", async () => {
    const m = await createBoard(db, T.member.id, T.org.id, T.project.id, { name: "Q1 plan", kind: "mindmap" });
    const [root] = (await getBoard(db, T.member.id, T.org.id, m.id)).items;
    expect(root).toMatchObject({ kind: "node", text: "Q1 plan", parentId: null });
    await expect(applyBoardOps(db, T.member.id, T.org.id, m.id, [{ op: "create", kind: "node", fields: { text: "orphan" } }])).rejects.toMatchObject({ code: "VALIDATION" });
    const [onboarding] = (await applyBoardOps(db, T.member.id, T.org.id, m.id, [{ op: "create", kind: "node", fields: { parentId: root!.id, text: "Onboarding" } }])).changed;
    const [, ] = (await applyBoardOps(db, T.member.id, T.org.id, m.id, [
      { op: "create", kind: "node", fields: { parentId: onboarding!.id, text: "Welcome email", y: 1 } },
      { op: "create", kind: "node", fields: { parentId: onboarding!.id, text: "Setup checklist", y: 2 } },
    ])).changed;
    const r = await mindmapBranchToTasks(db, T.member.id, T.org.id, root!.id); // root: each branch becomes a task
    const parent = r.created.find((t) => t.title === "Onboarding")!;
    expect(r.created.filter((t) => t.parentId === parent.id).map((t) => t.title).sort()).toEqual(["Setup checklist", "Welcome email"]);
    await applyBoardOps(db, T.member.id, T.org.id, m.id, [{ op: "create", kind: "node", fields: { parentId: onboarding!.id, text: "Kickoff call", y: 3 } }]);
    const again = await mindmapBranchToTasks(db, T.member.id, T.org.id, onboarding!.id);
    expect(again.created.map((t) => [t.title, t.parentId])).toEqual([["Kickoff call", parent.id]]);
    // Deleting a node removes its branch.
    await applyBoardOps(db, T.member.id, T.org.id, m.id, [{ op: "delete", id: onboarding!.id }]);
    const left = await db.select().from(whiteboardItems).where(and(eq(whiteboardItems.boardId, m.id)));
    expect(left.map((i) => i.text)).toEqual(["Q1 plan"]);
    void tasks;
    void taskDependencies;
  });
});
