import { beforeAll, describe, expect, it } from "vitest";
import { createTask, moveTask, updateTask } from "@/server/services/tasks";
import { projectFlowSeries } from "@/server/services/workspace";
import { addDays, addMonths, diffDays, dueState, relativeDueLabel, startOfWeek, weekdayMon } from "@/lib/dates";
import { applyFilters, activeFilterCount, EMPTY_FILTERS } from "@/components/board/filters";
import type { TaskDTO } from "@/lib/realtime-protocol";
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Plan");
  Other = await makeTenant("Other");
});

describe("planning fields", () => {
  it("creates tasks with start/due dates and story points", async () => {
    const t = await createTask(db, T.member.id, {
      organizationId: T.org.id,
      columnId: T.columns[0]!.id,
      title: "Scheduled",
      startDate: "2026-03-02",
      dueDate: "2026-03-06",
      storyPoints: 5,
    });
    expect(t).toMatchObject({ startDate: "2026-03-02", dueDate: "2026-03-06", storyPoints: 5 });
  });

  it("rejects a start date after the due date", async () => {
    await expect(
      createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Bad", startDate: "2026-03-10", dueDate: "2026-03-01" })
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects impossible calendar dates and out-of-range points", async () => {
    await expect(createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "x", dueDate: "2026-02-30" })).rejects.toThrow();
    await expect(createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "x", storyPoints: 500 })).rejects.toThrow();
  });

  it("validates date order against the merged row on partial updates", async () => {
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Partial", startDate: "2026-04-10" });
    // Only the due date is sent, but it would land before the stored start date.
    await expect(
      updateTask(db, T.member.id, { organizationId: T.org.id, taskId: t.id, expectedVersion: t.version, patch: { dueDate: "2026-04-01" } })
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await getTask(t.id))!.version).toBe(t.version);
  });

  it("reschedules with optimistic concurrency and audits before/after", async () => {
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Move me", dueDate: "2026-05-01" });
    const ok = await updateTask(db, T.member.id, {
      organizationId: T.org.id,
      taskId: t.id,
      expectedVersion: t.version,
      patch: { dueDate: "2026-05-08", storyPoints: 3 },
    });
    expect(ok).toMatchObject({ ok: true, changes: expect.arrayContaining(["dueDate", "storyPoints"]) });
    const stale = await updateTask(db, T.admin.id, { organizationId: T.org.id, taskId: t.id, expectedVersion: t.version, patch: { dueDate: "2026-06-01" } });
    expect(stale).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });
    expect(await getTask(t.id)).toMatchObject({ dueDate: "2026-05-08", storyPoints: 3 });
  });

  it("viewers cannot reschedule", async () => {
    await expect(
      updateTask(db, T.viewer.id, { organizationId: T.org.id, taskId: T.task.id, expectedVersion: 1, patch: { dueDate: "2026-01-01" } })
    ).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
  });
});

describe("dashboard flow series", () => {
  it("counts created and completed per day for the project", async () => {
    const done = T.columns[T.columns.length - 1]!;
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Ship it" });
    await moveTask(db, T.member.id, { organizationId: T.org.id, taskId: t.id, targetColumnId: done.id, newPosition: 9999, expectedVersion: t.version });

    const series = await projectFlowSeries(db, T.viewer.id, T.org.id, T.project.id, 14);
    expect(series).toHaveLength(14);
    const today = series[series.length - 1]!;
    expect(today.day).toBe(new Date().toISOString().slice(0, 10));
    expect(today.created).toBeGreaterThanOrEqual(1);
    expect(today.completed).toBe(1);
  });

  it("is tenant-isolated", async () => {
    await expect(projectFlowSeries(db, Other.owner.id, T.org.id, T.project.id)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    // Own org id + another tenant's project id resolves to nothing.
    await expect(projectFlowSeries(db, Other.owner.id, Other.org.id, T.project.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("date helpers", () => {
  it("does calendar math in UTC without drift", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30"); // EU DST weekend
    expect(diffDays("2026-03-01", "2026-03-31")).toBe(30);
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01"); // month starts, not day overflow
    expect(weekdayMon("2026-11-23")).toBe(0); // Monday
    expect(startOfWeek("2026-11-29")).toBe("2026-11-23"); // Sunday → Monday
  });

  it("classifies due dates", () => {
    const today = "2026-11-25";
    expect(dueState("2026-11-24", false, today)).toBe("overdue");
    expect(dueState("2026-11-24", true, today)).toBe("later"); // done is never overdue
    expect(dueState("2026-11-25", false, today)).toBe("today");
    expect(dueState("2026-11-27", false, today)).toBe("soon");
    expect(dueState("2026-12-10", false, today)).toBe("later");
    expect(dueState(null, false, today)).toBeNull();
    expect(relativeDueLabel("2026-11-26", today)).toBe("Tomorrow");
  });
});

describe("filters", () => {
  const mk = (id: string, over: Partial<TaskDTO>): TaskDTO => ({
    id, organizationId: "o", projectId: "p", columnId: "todo", taskNumber: 1, title: id, description: null,
    priority: "medium", assigneeId: null, position: 1, version: 1, updatedAt: "", createdAt: "",
    startDate: null, dueDate: null, storyPoints: null, parentId: null, type: "task", sprintId: null, ...over,
  });
  const tasks = {
    a: mk("a", { title: "Fix login bug", assigneeId: "me", priority: "urgent" }),
    b: mk("b", { title: "Write docs", assigneeId: "you", priority: "low", columnId: "done" }),
    c: mk("c", { title: "Refactor", taskNumber: 42 }),
  };
  const ctx = { meId: "me", doneColumnId: "done", refOf: (t: TaskDTO) => `ENG-${t.taskNumber}` };

  it("returns the same object when nothing is active", () => {
    expect(applyFilters(tasks, EMPTY_FILTERS, ctx)).toBe(tasks);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it("combines search, people, priority and hide-done", () => {
    expect(Object.keys(applyFilters(tasks, { ...EMPTY_FILTERS, q: "LOGIN" }, ctx))).toEqual(["a"]);
    expect(Object.keys(applyFilters(tasks, { ...EMPTY_FILTERS, q: "eng-42" }, ctx))).toEqual(["c"]);
    expect(Object.keys(applyFilters(tasks, { ...EMPTY_FILTERS, onlyMine: true }, ctx))).toEqual(["a"]);
    expect(Object.keys(applyFilters(tasks, { ...EMPTY_FILTERS, assignees: ["__none"] }, ctx))).toEqual(["c"]);
    expect(Object.keys(applyFilters(tasks, { ...EMPTY_FILTERS, priorities: ["urgent", "low"] }, ctx)).sort()).toEqual(["a", "b"]);
    expect(Object.keys(applyFilters(tasks, { ...EMPTY_FILTERS, hideDone: true }, ctx)).sort()).toEqual(["a", "c"]);
  });
});
