import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { boardColumns, notifications, organizations, reminders, taskFieldValues, taskTags, tasks } from "@/db/schema";
import { updateStatus, createField } from "@/server/services/customize";
import { computeFlow, flowMetrics } from "@/server/services/flow";
import * as forms from "@/server/services/forms";
import { deleteReminder, deliverDueReminders, listMyReminders, setReminder } from "@/server/services/reminders";
import { createTag } from "@/server/services/breakdown";
import { moveTask } from "@/server/services/tasks";
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;
const DAY = 86_400_000;

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Power");
  Other = await makeTenant("Elsewhere");
});

describe("WIP limits", () => {
  it("admins set and clear a limit; it must be a positive whole number", async () => {
    await updateStatus(db, T.owner.id, T.org.id, T.columns[1]!.id, { wipLimit: 3 });
    expect((await db.select().from(boardColumns).where(eq(boardColumns.id, T.columns[1]!.id)))[0]!.wipLimit).toBe(3);
    await expect(updateStatus(db, T.owner.id, T.org.id, T.columns[1]!.id, { wipLimit: 0 })).rejects.toThrow();
    await expect(updateStatus(db, T.member.id, T.org.id, T.columns[1]!.id, { wipLimit: 5 })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await updateStatus(db, T.owner.id, T.org.id, T.columns[1]!.id, { wipLimit: null });
    expect((await db.select().from(boardColumns).where(eq(boardColumns.id, T.columns[1]!.id)))[0]!.wipLimit).toBeNull();
  });
});

describe("flow analytics", () => {
  it("computes cumulative flow, lead and cycle time from history (pure)", () => {
    const now = new Date("2026-11-27T12:00:00Z");
    const d = (n: number) => new Date(now.getTime() - n * DAY);
    const cols = ["todo", "doing", "done"];
    const list = [
      { id: "a", ref: "X-1", title: "A", createdAt: d(10), columnId: "done" },
      { id: "b", ref: "X-2", title: "B", createdAt: d(5), columnId: "doing" },
      { id: "c", ref: "X-3", title: "C", createdAt: d(2), columnId: "todo" },
    ];
    const events = [
      { taskId: "a", at: d(10), from: null, to: "todo" },
      { taskId: "a", at: d(6), from: "todo", to: "doing" },
      { taskId: "a", at: d(2), from: "doing", to: "done" },
      { taskId: "b", at: d(5), from: null, to: "todo" },
      { taskId: "b", at: d(1), from: "todo", to: "doing" },
      { taskId: "c", at: d(2), from: null, to: "todo" },
    ];
    const f = computeFlow(cols, list, events, 14, now);
    expect(f.finished).toHaveLength(1);
    expect(f.finished[0]!.leadDays).toBeCloseTo(8, 5);
    expect(f.finished[0]!.cycleDays).toBeCloseTo(4, 5);
    expect(f.cycle.p50).toBe(4);
    const last = f.cfd[f.cfd.length - 1]!.counts;
    expect(last).toEqual({ todo: 1, doing: 1, done: 1 });
    const tenDaysAgo = f.cfd.find((x) => x.day === d(10).toISOString().slice(0, 10))!.counts;
    expect(tenDaysAgo).toEqual({ todo: 1, doing: 0, done: 0 });
    expect(f.wip).toBe(1);
    expect(f.throughput.reduce((s, w) => s + w.count, 0)).toBe(1);
  });

  it("reads real moves from the audit log, viewer-readable, tenant-scoped", async () => {
    const t = await getTask(T.task.id);
    await moveTask(db, T.member.id, { organizationId: T.org.id, taskId: t!.id, targetColumnId: T.columns[1]!.id, newPosition: 5, expectedVersion: t!.version });
    const t2 = await getTask(T.task.id);
    await moveTask(db, T.member.id, { organizationId: T.org.id, taskId: t2!.id, targetColumnId: T.columns[T.columns.length - 1]!.id, newPosition: 5, expectedVersion: t2!.version });
    const f = await flowMetrics(db, T.viewer.id, T.org.id, T.project.id, 30);
    expect(f.finished.map((x) => x.id)).toContain(T.task.id);
    expect(f.cycle.count).toBeGreaterThan(0);
    await expect(flowMetrics(db, Other.member.id, T.org.id, T.project.id, 30)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });
});

describe("intake forms", () => {
  it("creates a task from a public submission with tags, custom fields and a notification", async () => {
    const tag = await createTag(db, T.member.id, T.org.id, { name: "from-form", color: "#0f9d74" });
    const field = await createField(db, T.owner.id, T.org.id, T.project.id, { name: "Budget", type: "number" });
    await expect(forms.createForm(db, T.viewer.id, T.org.id, T.project.id, { name: "X", fields: forms.DEFAULT_FIELDS })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    await expect(forms.createForm(db, T.member.id, T.org.id, T.project.id, { name: "X", fields: [{ key: "name", label: "Name", required: true }] })).rejects.toThrow(/Summary/);
    const f = await forms.createForm(db, T.member.id, T.org.id, T.project.id, {
      name: "Requests", fields: [...forms.DEFAULT_FIELDS, { key: `custom:${field.id}`, label: "Budget", required: false }],
      columnId: T.columns[1]!.id, assigneeId: T.admin.id, tagIds: [tag.id], priority: "high",
    });
    const pub = await forms.getPublicForm(db, f.token);
    expect(pub!.fields.map((x) => x.key)).toContain(`custom:${field.id}`);
    expect(JSON.stringify(pub)).not.toContain(T.admin.id); // no people leak to the public page

    await expect(forms.submitForm(db, f.token, { title: "Need a login", name: "Cara" }, { ip: "1.1.1.1" })).rejects.toThrow(/Your email is required/);
    const r = await forms.submitForm(db, f.token, { title: "Need a login", description: "For the new hire", name: "Cara", email: "cara@client.example", [`custom:${field.id}`]: "250" }, { ip: "1.1.1.1" });
    expect(r.ref).toMatch(/^ENG-\d+$/);
    const task = (await db.select().from(tasks).where(eq(tasks.title, "Need a login")))[0]!;
    expect(task).toMatchObject({ columnId: T.columns[1]!.id, assigneeId: T.admin.id, priority: "high" });
    expect(task.description).toContain("cara@client.example");
    expect((await db.select().from(taskTags).where(eq(taskTags.taskId, task.id))).map((x) => x.tagId)).toEqual([tag.id]);
    expect((await db.select().from(taskFieldValues).where(eq(taskFieldValues.taskId, task.id)))[0]).toBeTruthy();
    const notes = (await db.select().from(notifications).where(eq(notifications.taskId, task.id))).filter((n) => n.kind === "form");
    expect(notes.map((n) => n.userId).sort()).toEqual([T.admin.id, T.member.id].sort());

    // Honeypot: looks successful, creates nothing.
    const bot = await forms.submitForm(db, f.token, { title: "spam", name: "x", email: "x@y.example" }, { ip: "9.9.9.9", honeypot: "http://spam" });
    expect(bot.ref).toBeNull();
    expect(await db.select().from(tasks).where(eq(tasks.title, "spam"))).toHaveLength(0);
    // Rate limit per address.
    for (let i = 0; i < 10; i++) await forms.submitForm(db, f.token, { title: `Burst ${i}`, name: "b", email: "b@b.example" }, { ip: "2.2.2.2" });
    await expect(forms.submitForm(db, f.token, { title: "Burst 11", name: "b", email: "b@b.example" }, { ip: "2.2.2.2" })).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });

    // Turned off / rotated links stop working; another tenant can't edit it.
    const old = f.token;
    const fresh = await forms.rotateFormLink(db, T.member.id, T.org.id, f.id);
    expect(await forms.getPublicForm(db, old)).toBeNull();
    expect(await forms.getPublicForm(db, fresh)).toBeTruthy();
    await expect(forms.deleteForm(db, Other.owner.id, T.org.id, f.id)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });

  it("stops accepting responses while the workspace is read-only", async () => {
    const W = await makeTenant("Paused");
    const f = await forms.createForm(db, W.member.id, W.org.id, W.project.id, { name: "Bugs", fields: forms.DEFAULT_FIELDS });
    // Trial ended without a plan: read-only.
    await db.update(organizations).set({ plan: "trial", billingStatus: "trialing", trialEndsAt: new Date(Date.now() - 2 * DAY) }).where(eq(organizations.id, W.org.id));
    await expect(forms.submitForm(db, f.token, { title: "x", name: "y", email: "y@z.example" }, { ip: "3.3.3.3" })).rejects.toThrow(/isn't accepting responses/);
  });
});

describe("reminders", () => {
  it("are personal, validated, delivered once to the inbox", async () => {
    const now = new Date();
    await expect(setReminder(db, T.viewer.id, T.org.id, T.task.id, { remindAt: new Date(now.getTime() - 3_600_000).toISOString() }, now)).rejects.toThrow(/future/);
    const r = await setReminder(db, T.viewer.id, T.org.id, T.task.id, { remindAt: new Date(now.getTime() + 60_000 * 5).toISOString(), note: "check this" }, now);
    expect(await listMyReminders(db, T.member.id, T.org.id, T.task.id)).toHaveLength(0); // someone else's
    await expect(setReminder(db, Other.member.id, T.org.id, T.task.id, { remindAt: new Date(now.getTime() + 60_000).toISOString() }, now)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    expect(await deliverDueReminders(db, now)).toHaveLength(0); // not yet
    const later = new Date(now.getTime() + 10 * 60_000);
    const sent = await deliverDueReminders(db, later);
    expect(sent).toEqual([{ organizationId: T.org.id, userIds: [T.viewer.id] }]);
    expect(await deliverDueReminders(db, later)).toHaveLength(0); // once only
    const inbox = await db.select().from(notifications).where(eq(notifications.userId, T.viewer.id));
    expect(inbox.some((n) => n.kind === "reminder" && n.body === "check this")).toBe(true);
    await expect(deleteReminder(db, T.member.id, T.org.id, r.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteReminder(db, T.viewer.id, T.org.id, r.id);
    expect(await db.select().from(reminders).where(eq(reminders.id, r.id))).toHaveLength(0);
  });
});
