import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { sprintSnapshots, sprints, tasks } from "@/db/schema";
import { createTask, moveTask, updateTask, deleteTask } from "@/server/services/tasks";
import {
  backlogCount,
  completeSprint,
  createSprint,
  deleteSprint,
  getSprintReport,
  getVelocity,
  listSprints,
  startSprint,
  updateSprint,
} from "@/server/services/sprints";
import { createProject } from "@/server/services/workspace";
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;
const today = () => new Date().toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const newTask = (title: string, extra: Record<string, unknown> = {}) =>
  createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title, ...extra });

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Agile");
  Other = await makeTenant("Elsewhere");
});

describe("sprint lifecycle", () => {
  it("creates sprints with sensible defaults (admins only)", async () => {
    await expect(createSprint(db, T.member.id, T.org.id, T.project.id)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    const s = await createSprint(db, T.admin.id, T.org.id, T.project.id);
    expect(s).toMatchObject({ name: "Sprint 1", status: "planned", startDate: today(), endDate: plus(13) });
    const s2 = await createSprint(db, T.admin.id, T.org.id, T.project.id);
    expect(s2.name).toBe("Sprint 2");
    expect(s2.startDate).toBe(plus(14)); // starts the day after the previous one ends
  });

  it("rejects end before start", async () => {
    await expect(createSprint(db, T.admin.id, T.org.id, T.project.id, { startDate: "2026-05-10", endDate: "2026-05-01" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("start → commitment + snapshot; only one active sprint per project", async () => {
    const s = await createSprint(db, T.admin.id, T.org.id, T.project.id, { name: "Commit test" });
    await newTask("Five", { sprintId: s.id, storyPoints: 5 });
    await newTask("Three", { sprintId: s.id, storyPoints: 3 });
    const started = await startSprint(db, T.admin.id, T.org.id, s.id);
    expect(started).toMatchObject({ status: "active", committedPoints: 8 });

    const [snap] = await db.select().from(sprintSnapshots).where(eq(sprintSnapshots.sprintId, s.id));
    expect(snap).toMatchObject({ day: today(), scopePoints: 8, completedPoints: 0, scopeTasks: 2 });

    const other = await createSprint(db, T.admin.id, T.org.id, T.project.id, { name: "Blocked start" });
    await expect(startSprint(db, T.admin.id, T.org.id, other.id)).rejects.toMatchObject({ code: "CONFLICT" });
    // The database backs this up too.
    await expect(db.update(sprints).set({ status: "active" }).where(eq(sprints.id, other.id))).rejects.toThrow();
  });

  it("snapshots follow task moves, point edits and sprint changes in the same transaction", async () => {
    const [active] = (await listSprints(db, T.viewer.id, T.org.id, T.project.id)).filter((s) => s.status === "active");
    const done = T.columns[T.columns.length - 1]!.id;
    const [five] = await db.select().from(tasks).where(and(eq(tasks.sprintId, active!.id), eq(tasks.storyPoints, 5)));

    await moveTask(db, T.member.id, { organizationId: T.org.id, taskId: five!.id, targetColumnId: done, newPosition: 5000, expectedVersion: five!.version });
    let [snap] = await db.select().from(sprintSnapshots).where(and(eq(sprintSnapshots.sprintId, active!.id), eq(sprintSnapshots.day, today())));
    expect(snap).toMatchObject({ scopePoints: 8, completedPoints: 5, completedTasks: 1 });

    // Scope creep: a new 2-pointer joins mid-sprint.
    const extra = await newTask("Scope creep", { storyPoints: 2 });
    await updateTask(db, T.member.id, { organizationId: T.org.id, taskId: extra.id, expectedVersion: extra.version, patch: { sprintId: active!.id } });
    [snap] = await db.select().from(sprintSnapshots).where(and(eq(sprintSnapshots.sprintId, active!.id), eq(sprintSnapshots.day, today())));
    expect(snap).toMatchObject({ scopePoints: 10, completedPoints: 5 });

    // Deleting a sprint task shrinks scope.
    await deleteTask(db, T.member.id, T.org.id, extra.id);
    [snap] = await db.select().from(sprintSnapshots).where(and(eq(sprintSnapshots.sprintId, active!.id), eq(sprintSnapshots.day, today())));
    expect(snap!.scopePoints).toBe(8);
  });

  it("report: series spans the sprint, future days are empty, ideal goes to zero", async () => {
    const [active] = (await listSprints(db, T.viewer.id, T.org.id, T.project.id)).filter((s) => s.status === "active");
    const report = await getSprintReport(db, T.viewer.id, T.org.id, active!.id);
    expect(report.days).toHaveLength(14);
    expect(report.days[0]).toMatchObject({ day: today(), scopePoints: 8, completedPoints: 5, remainingPoints: 3, future: false, ideal: 8 });
    expect(report.days[1]!.future).toBe(true);
    expect(report.days[13]!.ideal).toBe(0);
  });

  it("complete: carries unfinished work to the backlog or another sprint, records velocity", async () => {
    const [active] = (await listSprints(db, T.viewer.id, T.org.id, T.project.id)).filter((s) => s.status === "active");
    const next = await createSprint(db, T.admin.id, T.org.id, T.project.id, { name: "Next" });

    await expect(completeSprint(db, T.admin.id, T.org.id, active!.id, { moveOpenTo: active!.id })).rejects.toMatchObject({ code: "VALIDATION" });
    const res = await completeSprint(db, T.admin.id, T.org.id, active!.id, { moveOpenTo: next.id });
    expect(res.sprint).toMatchObject({ status: "completed", committedPoints: 8, completedPoints: 5 });
    expect(res.movedTasks).toHaveLength(1);
    expect(res.movedTasks[0]).toMatchObject({ sprintId: next.id, storyPoints: 3 });

    const velocity = await getVelocity(db, T.viewer.id, T.org.id, T.project.id);
    expect(velocity.at(-1)).toMatchObject({ name: "Commit test", committed: 8, completed: 5 });

    // Completed sprints are frozen.
    await expect(updateSprint(db, T.admin.id, T.org.id, active!.id, { name: "x" })).rejects.toMatchObject({ code: "VALIDATION" });
    const t = await newTask("Late addition");
    await expect(
      updateTask(db, T.member.id, { organizationId: T.org.id, taskId: t.id, expectedVersion: t.version, patch: { sprintId: active!.id } })
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("deleting a planned sprint returns its tasks to the backlog", async () => {
    const s = await createSprint(db, T.admin.id, T.org.id, T.project.id, { name: "Throwaway" });
    const t = await newTask("Parked", { sprintId: s.id });
    const before = await backlogCount(db, T.org.id, T.project.id);
    await deleteSprint(db, T.admin.id, T.org.id, s.id);
    expect((await getTask(t.id))!.sprintId).toBeNull();
    expect(await backlogCount(db, T.org.id, T.project.id)).toBe(before + 1);
  });
});

describe("sprint isolation and validation", () => {
  it("rejects another tenant's sprint and another project's sprint", async () => {
    const foreign = await createSprint(db, Other.admin.id, Other.org.id, Other.project.id);
    await expect(newTask("Smuggle", { sprintId: foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listSprints(db, Other.owner.id, T.org.id, T.project.id)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    await expect(startSprint(db, T.admin.id, T.org.id, foreign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const ops = await createProject(db, T.owner.id, { organizationId: T.org.id, name: "Ops", key: "OPS" });
    const opsSprint = await createSprint(db, T.admin.id, T.org.id, ops.id);
    await expect(newTask("Wrong board", { sprintId: opsSprint.id })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("work item types are validated", async () => {
    const bug = await newTask("Crash on save", { type: "bug" });
    expect(bug.type).toBe("bug");
    await expect(newTask("Weird", { type: "saga" })).rejects.toThrow();
  });
});

describe("demo seed sprints", () => {
  it("has velocity history, an active sprint with a burndown, and a planned sprint", async () => {
    const { seedDemoWorkspace } = await import("@/server/services/demo");
    const { listProjects } = await import("@/server/services/workspace");
    const org = await seedDemoWorkspace(db, T.owner.id);
    const { projects } = await listProjects(db, T.owner.id, org.slug);
    const eng = projects.find((p) => p.key === "ENG")!;

    const list = await listSprints(db, T.owner.id, org.id, eng.id);
    expect(list.map((s) => s.status)).toEqual(["active", "planned", "completed", "completed"]);

    const velocity = await getVelocity(db, T.owner.id, org.id, eng.id);
    expect(velocity.map((v) => v.name)).toEqual(["Sprint 1", "Sprint 2"]);

    const active = list[0]!;
    const report = await getSprintReport(db, T.owner.id, org.id, active.id);
    expect(report.days).toHaveLength(14);
    const todayPoint = report.days.find((d) => d.day === today())!;
    expect(todayPoint.future).toBe(false);
    expect(todayPoint.scopePoints).toBeGreaterThan(active.committedPoints!); // includes the mid-sprint scope increase
    expect(todayPoint.remainingPoints).toBe(todayPoint.scopePoints - todayPoint.completedPoints);

    const types = await db.select({ type: tasks.type }).from(tasks).where(eq(tasks.projectId, eng.id));
    expect(new Set(types.map((t) => t.type))).toEqual(new Set(["epic", "story", "task", "bug"]));
  });
});
