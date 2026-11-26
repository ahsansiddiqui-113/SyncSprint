import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { notifications, timeEntries } from "@/db/schema";
import { addComment, createTask, moveTask, updateTask } from "@/server/services/tasks";
import { setCoAssignees, setWatching } from "@/server/services/customize";
import {
  alertManagersOverCapacity,
  extractMentions,
  listNotifications,
  markRead,
  mentionsToText,
} from "@/server/services/notifications";
import { addManualEntry, deleteEntry, listTaskTime, runningTimer, startTimer, stopTimer, trackedMinutesFor } from "@/server/services/time-tracking";
import {
  deleteAttachment,
  listAttachments,
  normalizeContentType,
  readAttachment,
  safeFilename,
  uploadAttachment,
} from "@/server/services/attachments";
import { createDoc, deleteDoc, docsForTask, getDoc, listDocs, searchTasks, setDocTaskLink, updateDoc } from "@/server/services/docs";
import {
  addKeyResult,
  createGoal,
  listGoals,
  numberProgress,
  setKeyResultTaskLink,
  updateKeyResultValue,
} from "@/server/services/goals";
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;

const inbox = async (userId: string, orgId = T.org.id) => (await listNotifications(db, userId, orgId)).items;
const mention = (u: { id: string; name: string }) => `@[${u.name}](${u.id})`;

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Collab");
  Other = await makeTenant("Elsewhere");
});

/* -------------------------------- notifications ------------------------------- */

describe("mentions", () => {
  it("parses @[Name](uuid) tokens, de-duplicated, and renders plain text", () => {
    const id = "0b9d2a52-5d3c-4f0e-9a51-1f2e3d4c5b6a";
    const body = `hi @[Sara Khan](${id}) and again @[Sara Khan](${id}) — not @plain`;
    expect(extractMentions(body)).toEqual([id]);
    expect(mentionsToText(body)).toBe("hi @Sara Khan and again @Sara Khan — not @plain");
  });
});

describe("notifications", () => {
  it("assigning someone notifies them, never the person who assigned", async () => {
    const t = await createTask(db, T.admin.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Assigned on create", assigneeId: T.member.id });
    const items = await inbox(T.member.id);
    expect(items.find((n) => n.taskId === t.id)).toMatchObject({ kind: "assigned", actorId: T.admin.id });
    expect(items[0]!.link).toContain(`?task=${t.id}`);

    const self = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Self", assigneeId: T.member.id });
    expect((await inbox(T.member.id)).some((n) => n.taskId === self.id)).toBe(false);
  });

  it("reassigning via edit notifies the new assignee; unrelated edits don't", async () => {
    const t = await getTask(T.task.id);
    const r1 = await updateTask(db, T.owner.id, { organizationId: T.org.id, taskId: t!.id, expectedVersion: t!.version, patch: { title: "Renamed" } });
    expect(r1.ok && r1.notified).toEqual([]);
    const r2 = await updateTask(db, T.owner.id, { organizationId: T.org.id, taskId: t!.id, expectedVersion: t!.version + 1, patch: { assigneeId: T.admin.id } });
    expect(r2.ok && r2.notified).toEqual([T.admin.id]);
  });

  it("comments: mention wins over 'commented' per person; watchers and assignees hear about it; outsiders never", async () => {
    const t = await createTask(db, T.owner.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Discuss", assigneeId: T.member.id });
    await setWatching(db, T.viewer.id, T.org.id, t.id, true);
    const body = `${mention(T.member)} ${mention(T.admin)} please look ${mention(Other.member)}`;
    const c = await addComment(db, T.owner.id, T.org.id, t.id, body);
    expect(new Set(c.notified)).toEqual(new Set([T.member.id, T.admin.id, T.viewer.id]));

    const memberNotes = (await inbox(T.member.id)).filter((n) => n.taskId === t.id && n.kind !== "assigned");
    expect(memberNotes.map((n) => n.kind)).toEqual(["mention"]); // one per person, the mention
    expect(memberNotes[0]!.body).toContain(`@${T.member.name}`);
    expect((await inbox(T.viewer.id)).find((n) => n.taskId === t.id)?.kind).toBe("comment");
    // A mention of someone in another workspace is silently dropped.
    const leaked = await db.select().from(notifications).where(eq(notifications.userId, Other.member.id));
    expect(leaked).toHaveLength(0);
  });

  it("moving into Done notifies assignee, co-assignees and watchers", async () => {
    const t = await createTask(db, T.owner.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Ship it", assigneeId: T.member.id });
    const co = await setCoAssignees(db, T.owner.id, T.org.id, t.id, [T.admin.id]);
    expect(co.notified).toEqual([T.admin.id]);
    // Setting the same co-assignees again is not a new assignment.
    expect((await setCoAssignees(db, T.owner.id, T.org.id, t.id, [T.admin.id])).notified).toEqual([]);
    const done = T.columns[T.columns.length - 1]!;
    const mid = await moveTask(db, T.owner.id, { organizationId: T.org.id, taskId: t.id, targetColumnId: T.columns[1]!.id, newPosition: 5, expectedVersion: t.version });
    expect(mid.ok && mid.notified).toEqual([]);
    const fin = await moveTask(db, T.owner.id, { organizationId: T.org.id, taskId: t.id, targetColumnId: done.id, newPosition: 5, expectedVersion: t.version + 1 });
    expect(fin.ok && new Set(fin.notified)).toEqual(new Set([T.member.id, T.admin.id]));
  });

  it("inbox is personal and tenant-scoped; mark one / mark all read", async () => {
    const { items, unread } = await listNotifications(db, T.member.id, T.org.id);
    expect(unread).toBeGreaterThan(1);
    await markRead(db, T.admin.id, T.org.id, [items[0]!.id]); // someone else's id: no effect
    expect((await listNotifications(db, T.member.id, T.org.id)).unread).toBe(unread);
    await markRead(db, T.member.id, T.org.id, [items[0]!.id]);
    expect((await listNotifications(db, T.member.id, T.org.id)).unread).toBe(unread - 1);
    await markRead(db, T.member.id, T.org.id);
    expect((await listNotifications(db, T.member.id, T.org.id)).unread).toBe(0);
    await expect(listNotifications(db, T.member.id, Other.org.id)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });

  it("capacity alerts reach owners/admins once per person per day", async () => {
    const over = [{ userId: T.member.id, name: T.member.name, day: "2026-12-01", load: 11, capacity: 8 }];
    const first = await alertManagersOverCapacity(db, T.org.id, T.admin.id, over, null);
    expect(first).toEqual([T.owner.id]); // admin did it, so only the owner is told
    const again = await alertManagersOverCapacity(db, T.org.id, T.owner.id, over, null);
    expect(again).toEqual([T.admin.id]); // owner already has today's alert for this person
    expect(await alertManagersOverCapacity(db, T.org.id, null, over, null)).toEqual([]);
    const rows = await db.select().from(notifications).where(and(eq(notifications.organizationId, T.org.id), eq(notifications.kind, "capacity")));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.body).toContain("11h of 8h");
  });
});

/* -------------------------------- time tracking ------------------------------- */

describe("time tracking", () => {
  it("one running timer per person: starting another stops the first", async () => {
    const a = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Timer A" });
    const b = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Timer B" });
    await startTimer(db, T.member.id, T.org.id, a.id);
    const second = await startTimer(db, T.member.id, T.org.id, b.id);
    expect(second.stopped?.taskId).toBe(a.id);
    expect(second.stopped?.endedAt).not.toBeNull();
    expect((await runningTimer(db, T.member.id, T.org.id))?.taskId).toBe(b.id);
    const stopped = await stopTimer(db, T.member.id, T.org.id);
    expect(stopped.discarded).toBe(true); // under a minute: not logged
    expect(await listTaskTime(db, T.member.id, T.org.id, b.id)).toHaveLength(0);
    expect(await listTaskTime(db, T.member.id, T.org.id, a.id)).toHaveLength(0);
    expect(await runningTimer(db, T.member.id, T.org.id)).toBeNull();
    await expect(stopTimer(db, T.member.id, T.org.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the database itself refuses two running timers", async () => {
    const t = await createTask(db, T.admin.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Race" });
    await db.insert(timeEntries).values({ organizationId: T.org.id, taskId: t.id, userId: T.admin.id, startedAt: new Date() });
    await expect(db.insert(timeEntries).values({ organizationId: T.org.id, taskId: t.id, userId: T.admin.id, startedAt: new Date() })).rejects.toThrow();
    await stopTimer(db, T.admin.id, T.org.id);
  });

  it("manual entries, totals, and who may delete", async () => {
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Logged", estimateHours: 4 });
    const mine = await addManualEntry(db, T.member.id, T.org.id, { taskId: t.id, minutes: 90, date: "2026-11-02", note: "pairing" });
    await addManualEntry(db, T.admin.id, T.org.id, { taskId: t.id, minutes: 30, date: "2026-11-03" });
    expect((await trackedMinutesFor(db, T.org.id, [t.id]))[t.id]).toBe(120);
    expect(await listTaskTime(db, T.viewer.id, T.org.id, t.id)).toHaveLength(2);

    await expect(addManualEntry(db, T.member.id, T.org.id, { taskId: t.id, minutes: 0, date: "2026-11-02" })).rejects.toThrow();
    await expect(addManualEntry(db, T.member.id, T.org.id, { taskId: t.id, minutes: 30, date: "2099-01-01" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(addManualEntry(db, T.viewer.id, T.org.id, { taskId: t.id, minutes: 30, date: "2026-11-02" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    await expect(deleteEntry(db, T.member.id, T.org.id, (await listTaskTime(db, T.member.id, T.org.id, t.id)).find((e) => e.userId === T.admin.id)!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteEntry(db, T.owner.id, T.org.id, mine.entry.id); // admins/owners can clean up
    expect((await trackedMinutesFor(db, T.org.id, [t.id]))[t.id]).toBe(30);
  });

  it("tasks from another workspace look missing", async () => {
    await expect(startTimer(db, T.member.id, T.org.id, Other.task.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addManualEntry(db, T.member.id, T.org.id, { taskId: Other.task.id, minutes: 5, date: "2026-11-02" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/* --------------------------------- attachments -------------------------------- */

describe("attachments", () => {
  it("sanitises names and content types", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename('C:\\x\\re"port<1>.pdf')).toBe("re_port_1_.pdf");
    expect(normalizeContentType("image/png; charset=binary")).toBe("image/png");
    expect(normalizeContentType("text/html<script>")).toBe("application/octet-stream");
    expect(normalizeContentType(null)).toBe("application/octet-stream");
  });

  it("upload, list, read (members of the workspace only), delete by uploader or admin", async () => {
    const data = Buffer.from("hello world");
    const { attachment } = await uploadAttachment(db, T.member.id, T.org.id, { taskId: T.task.id, filename: "notes.txt", contentType: "text/plain", data });
    expect(attachment).toMatchObject({ filename: "notes.txt", size: 11 });
    expect(await listAttachments(db, T.viewer.id, T.org.id, T.task.id)).toHaveLength(1);
    const row = await readAttachment(db, T.viewer.id, attachment.id);
    expect(Buffer.from(row.data).toString()).toBe("hello world");
    await expect(readAttachment(db, Other.owner.id, attachment.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(uploadAttachment(db, T.viewer.id, T.org.id, { taskId: T.task.id, filename: "x", contentType: null, data })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    await expect(uploadAttachment(db, T.member.id, T.org.id, { taskId: Other.task.id, filename: "x", contentType: null, data })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteAttachment(db, T.admin.id, Other.org.id, attachment.id)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    const other = await uploadAttachment(db, T.admin.id, T.org.id, { taskId: T.task.id, filename: "a.png", contentType: "image/png", data });
    await expect(deleteAttachment(db, T.member.id, T.org.id, other.attachment.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteAttachment(db, T.admin.id, T.org.id, attachment.id);
    expect(await listAttachments(db, T.member.id, T.org.id, T.task.id)).toHaveLength(1);
  });

  it("rejects empty and oversized files", async () => {
    await expect(uploadAttachment(db, T.member.id, T.org.id, { taskId: T.task.id, filename: "e", contentType: null, data: Buffer.alloc(0) })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(uploadAttachment(db, T.member.id, T.org.id, { taskId: T.task.id, filename: "big", contentType: null, data: Buffer.alloc(4 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

/* ------------------------------------ docs ------------------------------------ */

describe("docs", () => {
  it("create, list/search, link tasks, delete", async () => {
    const d = await createDoc(db, T.member.id, T.org.id, { title: "Release checklist", content: "# Steps\n- [ ] tag" });
    expect((await listDocs(db, T.viewer.id, T.org.id, { q: "release" })).map((x) => x.id)).toEqual([d.id]);
    expect(await listDocs(db, T.viewer.id, T.org.id, { q: "100%" })).toEqual([]);
    await setDocTaskLink(db, T.member.id, T.org.id, d.id, T.task.id, true);
    await setDocTaskLink(db, T.member.id, T.org.id, d.id, T.task.id, true); // idempotent
    expect((await getDoc(db, T.viewer.id, T.org.id, d.id)).tasks).toHaveLength(1);
    expect((await docsForTask(db, T.viewer.id, T.org.id, T.task.id)).map((x) => x.title)).toEqual(["Release checklist"]);
    await expect(setDocTaskLink(db, T.member.id, T.org.id, d.id, Other.task.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getDoc(db, Other.owner.id, Other.org.id, d.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteDoc(db, T.viewer.id, T.org.id, d.id)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    const theirs = await createDoc(db, T.admin.id, T.org.id, { title: "Admin's page" });
    await expect(deleteDoc(db, T.member.id, T.org.id, theirs.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteDoc(db, T.admin.id, T.org.id, theirs.id);
    await deleteDoc(db, T.admin.id, T.org.id, d.id);
    expect(await listDocs(db, T.member.id, T.org.id)).toHaveLength(0);
  });

  it("concurrent saves: the second writer gets VERSION_CONFLICT instead of overwriting", async () => {
    const d = await createDoc(db, T.member.id, T.org.id, { title: "Spec" });
    const a = await updateDoc(db, T.member.id, T.org.id, { docId: d.id, expectedVersion: 1, content: "Alice's draft" });
    expect(a.version).toBe(2);
    await expect(updateDoc(db, T.admin.id, T.org.id, { docId: d.id, expectedVersion: 1, content: "Bob's draft" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect((await getDoc(db, T.member.id, T.org.id, d.id)).content).toBe("Alice's draft");
    await expect(updateDoc(db, T.viewer.id, T.org.id, { docId: d.id, expectedVersion: 2, content: "x" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
  });

  it("task search by reference or title, scoped to the workspace", async () => {
    const byRef = await searchTasks(db, T.member.id, T.org.id, `ENG-${T.task.taskNumber}`);
    expect(byRef.map((t) => t.id)).toEqual([T.task.id]);
    const byTitle = await searchTasks(db, T.member.id, T.org.id, "first task");
    expect(byTitle.every((t) => t.id !== Other.task.id)).toBe(true);
  });
});

/* ------------------------------------ goals ----------------------------------- */

describe("goals", () => {
  it("numeric progress clamps and handles decreasing targets", () => {
    expect(numberProgress(0, 100, 25)).toBe(0.25);
    expect(numberProgress(0, 100, 150)).toBe(1);
    expect(numberProgress(10, 2, 6)).toBe(0.5); // e.g. bugs down from 10 to 2
    expect(numberProgress(5, 5, 5)).toBe(1);
  });

  it("admins create goals; key results track numbers or linked work", async () => {
    await expect(createGoal(db, T.member.id, T.org.id, { title: "Nope" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(createGoal(db, T.admin.id, T.org.id, { title: "Bad owner", ownerId: Other.owner.id })).rejects.toMatchObject({ code: "VALIDATION" });
    const g = await createGoal(db, T.admin.id, T.org.id, { title: "Launch v2", dueDate: "2026-12-31" });
    const num = await addKeyResult(db, T.admin.id, T.org.id, g.id, { title: "Signups", kind: "number", startValue: 0, targetValue: 200, unit: "users" });
    const work = await addKeyResult(db, T.admin.id, T.org.id, g.id, { title: "Ship features", kind: "tasks" });
    await expect(addKeyResult(db, T.admin.id, T.org.id, g.id, { title: "Flat", kind: "number", startValue: 5, targetValue: 5 })).rejects.toThrow();

    await updateKeyResultValue(db, T.member.id, T.org.id, num.id, 50);
    await expect(updateKeyResultValue(db, T.member.id, T.org.id, work.id, 50)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const a = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Feature A" });
    const b = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Feature B" });
    await setKeyResultTaskLink(db, T.member.id, T.org.id, work.id, a.id, true);
    await setKeyResultTaskLink(db, T.member.id, T.org.id, work.id, b.id, true);
    await expect(setKeyResultTaskLink(db, T.member.id, T.org.id, num.id, a.id, true)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setKeyResultTaskLink(db, T.member.id, T.org.id, work.id, Other.task.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await moveTask(db, T.member.id, { organizationId: T.org.id, taskId: a.id, targetColumnId: T.columns.at(-1)!.id, newPosition: 7, expectedVersion: a.version });

    const [goal] = await listGoals(db, T.viewer.id, T.org.id);
    const kr = Object.fromEntries(goal!.keyResults.map((k) => [k.title, k]));
    expect(kr["Signups"]!.progress).toBe(0.25);
    expect(kr["Ship features"]).toMatchObject({ done: 1, total: 2, progress: 0.5 });
    expect(goal!.progress).toBeCloseTo(0.375);
    expect(await listGoals(db, Other.owner.id, Other.org.id)).toEqual([]);
  });
});

describe("mention + duration helpers (client)", async () => {
  const { activeMentionQuery, encodeMentions, parseDuration, parseMentions } = await import("@/lib/mentions");
  it("encodes picked names (longest first) and leaves look-alikes alone", () => {
    const sara = { id: "11111111-1111-4111-8111-111111111111", name: "Sara" };
    const saraK = { id: "22222222-2222-4222-8222-222222222222", name: "Sara Khan" };
    const out = encodeMentions("hey @Sara Khan and @Sara, mail sara@x.com", [sara, saraK]);
    expect(out).toBe(`hey @[Sara Khan](${saraK.id}) and @[Sara](${sara.id}), mail sara@x.com`);
    expect(parseMentions(out).filter((p) => p.kind === "mention")).toHaveLength(2);
  });
  it("detects the @query being typed", () => {
    expect(activeMentionQuery("hello @sa")).toBe("sa");
    expect(activeMentionQuery("@")).toBe("");
    expect(activeMentionQuery("mail me@x")).toBeNull();
  });
  it("parses human durations", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("2 hours")).toBe(120);
    expect(parseDuration("1:15")).toBe(75);
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("25h")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });
});
