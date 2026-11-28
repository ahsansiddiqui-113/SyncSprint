import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  addTimeOff,
  capacityWarnings,
  computeLoad,
  getWorkload,
  setMemberCapacity,
  setWorkSchedule,
  statusFor,
  resolveToday,
  utcToday,
  weekOf,
  DEFAULT_HOURS,
  type CapacitySettings,
} from "@/server/services/capacity";
import { createTask, moveTask, updateTask } from "@/server/services/tasks";
import { setCoAssignees } from "@/server/services/customize";
import { makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";
import type { WeekHours } from "@/db/schema";

/* ---------------------------- pure calculation ---------------------------- */

// Fixed calendar: Mon 2026-11-23 … Sun 2026-11-29.
const MON = "2026-11-23";
const settings = (over: Partial<CapacitySettings> = {}): CapacitySettings => ({ defaultHours: DEFAULT_HOURS, nearThreshold: 85, overrides: {}, ...over });
const person = (userId: string) => ({ userId, name: userId, avatarUrl: null });
const task = (id: string, o: Partial<{ estimateHours: number | null; startDate: string | null; dueDate: string | null; assignees: string[] }>) => ({
  id, ref: id, title: id, projectKey: "ENG", estimateHours: 8, startDate: null, dueDate: null, assignees: ["a"], ...o,
});
const run = (tasks: ReturnType<typeof task>[], opts: { settings?: CapacitySettings; timeOff?: { userId: string | null; kind: "vacation" | "holiday" | "sick" | "other"; startDate: string; endDate: string }[]; today?: string; people?: string[] } = {}) =>
  computeLoad({
    from: MON,
    to: "2026-11-29",
    today: opts.today ?? MON,
    people: (opts.people ?? ["a", "b"]).map(person),
    settings: opts.settings ?? settings(),
    timeOff: opts.timeOff ?? [],
    tasks,
  });
const day = (p: ReturnType<typeof run>[number], d: string) => p.days.find((c) => c.day === d)!;

describe("capacity: viewer-local today", () => {
  it("trusts the browser date within one day of the server (time zones), otherwise falls back", () => {
    const server = utcToday();
    const d = (n: number) => new Date(Date.parse(`${server}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    expect(resolveToday(d(1))).toBe(d(1)); // e.g. Pakistan after midnight
    expect(resolveToday(d(-1))).toBe(d(-1)); // e.g. Hawaii in the evening
    expect(resolveToday(d(5))).toBe(server); // implausible: ignored
    expect(resolveToday("not-a-date")).toBe(server);
    expect(resolveToday(undefined)).toBe(server);
  });
});

describe("capacity: core rules (modelled on Azure Boards + ClickUp)", () => {
  it("default schedule is Mon–Fri 8h = 40h/week", () => {
    const [a] = run([]);
    expect(a!.totalCapacity).toBe(40);
    expect(day(a!, "2026-11-28").capacity).toBe(0); // Saturday
  });

  it("spreads an estimate evenly across working days from start to due", () => {
    const [a] = run([task("t", { estimateHours: 16, startDate: MON, dueDate: "2026-11-24" })]);
    expect(day(a!, MON).load).toBe(8);
    expect(day(a!, "2026-11-24").load).toBe(8);
  });

  it("skips weekends and time off when spreading", () => {
    // Wed → Sun with Thursday off: only Wednesday and Friday are working days.
    const [a] = run([task("t", { estimateHours: 9, startDate: "2026-11-25", dueDate: "2026-11-29" })], {
      timeOff: [{ userId: "a", kind: "vacation", startDate: "2026-11-26", endDate: "2026-11-26" }],
    });
    // Working days left: Wed 25, Fri 27 (Thu off, Sat/Sun weekend) → 4.5h each.
    expect(day(a!, "2026-11-25").load).toBe(4.5);
    expect(day(a!, "2026-11-26").load).toBe(0);
    expect(day(a!, "2026-11-26").off).toBe("vacation");
    expect(day(a!, "2026-11-27").load).toBe(4.5);
    expect(day(a!, "2026-11-28").load).toBe(0);
  });

  it("a due-date-only task lands on its due date", () => {
    const [a] = run([task("t", { estimateHours: 5, dueDate: "2026-11-25" })]);
    expect(day(a!, "2026-11-25").load).toBe(5);
  });

  it("splits a task's estimate evenly between assignees", () => {
    const [a, b] = run([task("t", { estimateHours: 10, dueDate: MON, assignees: ["a", "b"] })]);
    expect(day(a!, MON).load).toBe(5);
    expect(day(b!, MON).load).toBe(5);
  });

  it("splits by ALL assignees even when only one person is computed", () => {
    const [a] = run([task("t", { estimateHours: 10, dueDate: MON, assignees: ["a", "b"] })], { people: ["a"] });
    expect(day(a!, MON).load).toBe(5);
  });

  it("overdue open work piles onto today and is flagged", () => {
    const [a] = run([task("t", { estimateHours: 3, dueDate: "2026-11-20" })], { today: "2026-11-25" });
    const today = day(a!, "2026-11-25");
    expect(today.load).toBe(3);
    expect(today.items[0]!.overdue).toBe(true);
  });

  it("only remaining days count: started tasks spread from today, not the past", () => {
    const [a] = run([task("t", { estimateHours: 6, startDate: MON, dueDate: "2026-11-27" })], { today: "2026-11-25" });
    expect(day(a!, MON).load).toBe(0);
    expect(day(a!, "2026-11-25").load).toBe(2);
    expect(day(a!, "2026-11-27").load).toBe(2);
  });

  it("part-time overrides change capacity per weekday", () => {
    const partTime: WeekHours = [4, 4, 4, 4, 0, 0, 0];
    const [a] = run([], { settings: settings({ overrides: { a: partTime } }) });
    expect(a!.totalCapacity).toBe(16);
    expect(a!.customized).toBe(true);
  });

  it("workspace holidays (userId null) apply to everyone", () => {
    const [a, b] = run([], { timeOff: [{ userId: null, kind: "holiday", startDate: "2026-11-26", endDate: "2026-11-26" }] });
    expect(a!.totalCapacity).toBe(32);
    expect(b!.totalCapacity).toBe(32);
  });

  it("is judged per day first: a 12h Monday is 'over' even if the week fits", () => {
    const [a] = run([task("t", { estimateHours: 12, dueDate: MON })]);
    expect(a!.totalLoad).toBe(12);
    expect(a!.overDays).toBe(1);
    expect(a!.status).toBe("over");
  });

  it("work that can only land on a non-working day is over (ClickUp shows it red)", () => {
    const [a] = run([task("t", { estimateHours: 2, startDate: "2026-11-28", dueDate: "2026-11-29" })]);
    expect(day(a!, "2026-11-29").load).toBe(2);
    expect(statusFor(2, 0, 85)).toBe("over");
    expect(a!.status).toBe("over");
  });

  it("tasks without an estimate or without dates are counted separately, not as zero load", () => {
    const [a] = run([task("noest", { estimateHours: null, dueDate: MON }), task("nodate", { estimateHours: 4 })]);
    expect(a!.unestimated).toBe(1);
    expect(a!.unscheduled).toBe(1);
    expect(a!.totalLoad).toBe(0);
  });

  it("near-capacity threshold", () => {
    expect(statusFor(34, 40, 85)).toBe("near");
    expect(statusFor(33, 40, 85)).toBe("ok");
    expect(statusFor(40, 40, 85)).toBe("near"); // exactly full is near, not over
    expect(statusFor(40.5, 40, 85)).toBe("over");
    expect(statusFor(0, 40, 85)).toBe("idle");
  });
});

/* ------------------------------ with database ------------------------------ */

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Cap");
  Other = await makeTenant("Elsewhere");
});

describe("capacity: settings and permissions", () => {
  it("only owners/admins change schedules, capacity and time off", async () => {
    await expect(setWorkSchedule(db, T.member.id, T.org.id, { hours: [8, 8, 8, 8, 8, 0, 0] })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(setMemberCapacity(db, T.member.id, T.org.id, T.member.id, [4, 4, 4, 4, 4, 0, 0])).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(addTimeOff(db, T.member.id, T.org.id, { userId: T.member.id, startDate: "2026-12-01", endDate: "2026-12-02" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
  });

  it("validates schedules and refuses people from other workspaces", async () => {
    await expect(setWorkSchedule(db, T.admin.id, T.org.id, { hours: [0, 0, 0, 0, 0, 0, 0] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setWorkSchedule(db, T.admin.id, T.org.id, { hours: [25, 8, 8, 8, 8, 0, 0] })).rejects.toThrow();
    await expect(setMemberCapacity(db, T.admin.id, T.org.id, Other.member.id, [8, 8, 8, 8, 8, 0, 0])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addTimeOff(db, T.admin.id, T.org.id, { userId: T.member.id, startDate: "2026-12-05", endDate: "2026-12-01" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("workload is tenant-isolated", async () => {
    const w = weekOf(utcToday());
    await expect(getWorkload(db, Other.owner.id, T.org.id, w)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });
});

describe("capacity: warnings never block assignment", () => {
  it("assigning work beyond capacity saves the task and returns an 'over' warning", async () => {
    const today = utcToday();
    // Give the member a 4h day today so a 10h task overloads them regardless of weekday.
    const hours = [4, 4, 4, 4, 4, 4, 4] as WeekHours;
    await setMemberCapacity(db, T.admin.id, T.org.id, T.member.id, hours);

    const t = await createTask(db, T.member.id, {
      organizationId: T.org.id,
      columnId: T.columns[0]!.id,
      title: "Big job",
      assigneeId: T.member.id,
      estimateHours: 10,
      dueDate: today,
    });
    expect(t.id).toBeTruthy(); // saved — not blocked
    const warnings = await capacityWarnings(db, T.org.id, [T.member.id], t);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ userId: T.member.id, level: "over" });
    expect(warnings[0]!.overDays[0]).toMatchObject({ day: today, load: 10, capacity: 4 });
  });

  it("adding a co-assignee splits the load and can clear the warning", async () => {
    const today = utcToday();
    await setMemberCapacity(db, T.admin.id, T.org.id, T.admin.id, [8, 8, 8, 8, 8, 8, 8]);
    await setMemberCapacity(db, T.admin.id, T.org.id, T.member.id, [8, 8, 8, 8, 8, 8, 8]);
    const t = await createTask(db, T.member.id, {
      organizationId: T.org.id,
      columnId: T.columns[0]!.id,
      title: "Shared job",
      assigneeId: T.member.id,
      estimateHours: 12,
      dueDate: today,
    });
    // The earlier 10h task is still on the member today, so close it first to isolate this case.
    const { tasks: tasksTable } = await import("@/db/schema");
    const { eq, and } = await import("drizzle-orm");
    const [big] = await db.select().from(tasksTable).where(and(eq(tasksTable.organizationId, T.org.id), eq(tasksTable.title, "Big job")));
    const done = T.columns[T.columns.length - 1]!.id;
    await moveTask(db, T.member.id, { organizationId: T.org.id, taskId: big!.id, targetColumnId: done, newPosition: 99_999, expectedVersion: big!.version });

    expect((await capacityWarnings(db, T.org.id, [T.member.id], t))[0]).toMatchObject({ level: "over" }); // 12h on an 8h day
    await setCoAssignees(db, T.member.id, T.org.id, t.id, [T.admin.id]);
    const after = await capacityWarnings(db, T.org.id, [T.member.id, T.admin.id], t);
    expect(after.filter((w) => w.level === "over")).toHaveLength(0); // 6h each
  });

  it("time off turns a normal day into an overloaded one", async () => {
    const today = utcToday();
    await addTimeOff(db, T.admin.id, T.org.id, { userId: T.viewer.id, kind: "vacation", startDate: today, endDate: today });
    await setMemberCapacity(db, T.admin.id, T.org.id, T.viewer.id, [8, 8, 8, 8, 8, 8, 8]);
    const t = await createTask(db, T.member.id, {
      organizationId: T.org.id,
      columnId: T.columns[0]!.id,
      title: "Due on vacation",
      assigneeId: T.viewer.id,
      estimateHours: 2,
      dueDate: today,
    });
    const [w] = await capacityWarnings(db, T.org.id, [T.viewer.id], t);
    expect(w).toMatchObject({ level: "over" });
    expect(w!.overDays[0]).toMatchObject({ capacity: 0, load: 2 });
  });

  it("estimates use quarter-hour steps", async () => {
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Est" });
    await expect(updateTask(db, T.member.id, { organizationId: T.org.id, taskId: t.id, expectedVersion: t.version, patch: { estimateHours: 1.3 } })).rejects.toThrow();
    const ok = await updateTask(db, T.member.id, { organizationId: T.org.id, taskId: t.id, expectedVersion: t.version, patch: { estimateHours: 1.25 } });
    expect(ok).toMatchObject({ ok: true });
  });
});

describe("capacity: demo seed", () => {
  it("shows a part-time teammate and someone at or over capacity this week", async () => {
    const { seedDemoWorkspace } = await import("@/server/services/demo");
    const org = await seedDemoWorkspace(db, T.owner.id);
    const { people, settings } = await getWorkload(db, T.owner.id, org.id, weekOf(utcToday()));
    expect(settings.defaultHours).toEqual([8, 8, 8, 8, 8, 0, 0]);
    const alex = people.find((p) => p.name === "Alex Rivera")!;
    const priya = people.find((p) => p.name === "Priya Patel")!;
    expect(["near", "over"]).toContain(alex.status);
    expect(alex.totalLoad).toBeGreaterThanOrEqual(24);
    expect(priya.customized).toBe(true);
    expect(priya.totalCapacity).toBe(24);
  });
});

describe("capacity: demo seed on every day of the week", () => {
  afterEach(() => vi.useRealTimers());
  // A Monday-to-Sunday week: the demo's overloaded teammate must show in "this week" whichever day it's opened.
  for (const iso of ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"]) {
    it(`Alex is at or over capacity this week on ${iso}`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(`${iso}T10:00:00Z`));
      const T2 = await makeTenant(`Week ${iso}`);
      const { seedDemoWorkspace } = await import("@/server/services/demo");
      const org = await seedDemoWorkspace(db, T2.owner.id);
      const { people } = await getWorkload(db, T2.owner.id, org.id, weekOf(utcToday()));
      const alex = people.find((p) => p.name === "Alex Rivera")!;
      expect(["near", "over"]).toContain(alex.status);
      expect(alex.totalLoad).toBeGreaterThanOrEqual(24);
    });
  }
});
