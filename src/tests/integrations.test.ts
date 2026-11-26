import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { orgMembers, sprints, tasks, webhookDeliveries, webhooks } from "@/db/schema";
import { authenticateApiKey, createApiKey, listApiKeys, revokeApiKey, takeRateLimit } from "@/server/services/api-keys";
import {
  assertSafeUrl,
  createWebhook,
  deliver,
  dispatchEvent,
  isPrivateAddress,
  pingWebhook,
  sign,
  verifySignature,
} from "@/server/services/webhooks";
import { parseCsv, safeCell, toCsv } from "@/lib/csv";
import { commitImport, exportProjectCsv, parseDate, previewImport } from "@/server/services/import-export";
import { createSprint } from "@/server/services/sprints";
import { sprintCapacity } from "@/server/services/sprint-capacity";
import { createTask } from "@/server/services/tasks";
import { createProject } from "@/server/services/workspace";
import { createFanout } from "@/server/realtime-fanout";
import * as meRoute from "@/app/api/v1/me/route";
import * as tasksRoute from "@/app/api/v1/projects/[key]/tasks/route";
import * as taskRoute from "@/app/api/v1/tasks/[id]/route";
import * as commentsRoute from "@/app/api/v1/tasks/[id]/comments/route";
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";
import type { OrgEvent } from "@/lib/realtime-protocol";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Integr");
  Other = await makeTenant("Elsewhere");
});

const req = (url: string, token: string | null, init: RequestInit = {}) =>
  new Request(`http://localhost/api/v1${url}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });

/* ---------------------------------- API keys ---------------------------------- */

describe("API keys", () => {
  it("admins create keys; only a hash is stored; revoked or orphaned keys stop working", async () => {
    await expect(createApiKey(db, T.member.id, T.org.id, { name: "x", scope: "read" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    const { token, key } = await createApiKey(db, T.admin.id, T.org.id, { name: "CI", scope: "write" });
    expect(token).toMatch(/^ssk_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(token.startsWith(`ssk_${key.prefix}_`)).toBe(true);
    const listed = await listApiKeys(db, T.admin.id, T.org.id);
    expect(JSON.stringify(listed)).not.toContain(token.split("_")[2]);
    expect(await authenticateApiKey(db, token)).toMatchObject({ organizationId: T.org.id, userId: T.admin.id, scope: "write" });
    expect(await authenticateApiKey(db, token.slice(0, -1) + "x")).toBeNull();
    expect(await authenticateApiKey(db, "garbage")).toBeNull();
    await revokeApiKey(db, T.admin.id, T.org.id, key.id);
    expect(await authenticateApiKey(db, token)).toBeNull();
    await expect(revokeApiKey(db, Other.owner.id, Other.org.id, key.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rate limit: 120/min per key with a retry hint", () => {
    const now = 1_000_000;
    for (let i = 0; i < 120; i++) expect(takeRateLimit("k-test", now).ok).toBe(true);
    const blocked = takeRateLimit("k-test", now);
    expect(blocked).toMatchObject({ ok: false });
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(takeRateLimit("k-test", now + 1_000).ok).toBe(true); // refills
  });
});

/* ------------------------------------ REST ------------------------------------ */

describe("REST API (route handlers end to end)", () => {
  let write: string;
  let read: string;
  beforeAll(async () => {
    write = (await createApiKey(db, T.admin.id, T.org.id, { name: "write", scope: "write" })).token;
    read = (await createApiKey(db, T.admin.id, T.org.id, { name: "read", scope: "read" })).token;
  });

  it("rejects missing/invalid keys and read-only writes", async () => {
    expect((await meRoute.GET(req("/me", null))).status).toBe(401);
    expect((await meRoute.GET(req("/me", "ssk_nope"))).status).toBe(401);
    const me = await (await meRoute.GET(req("/me", read))).json();
    expect(me.data).toMatchObject({ organizationId: T.org.id, scope: "read" });
    const res = await tasksRoute.POST(req("/projects/ENG/tasks", read, { method: "POST", body: JSON.stringify({ title: "nope" }) }), params({ key: "ENG" }));
    expect(res.status).toBe(403);
  });

  it("creates, reads by ref, moves by status name, comments, lists with filters and deletes", async () => {
    const created = await tasksRoute.POST(
      req("/projects/eng/tasks", write, { method: "POST", body: JSON.stringify({ title: "From CI", priority: "high", status: "in progress", assignee: T.member.email, dueDate: "2026-12-01" }) }),
      params({ key: "eng" })
    );
    expect(created.status).toBe(201);
    const { data: task } = await created.json();
    expect(task).toMatchObject({ title: "From CI", priority: "high", status: "In Progress", assignee: { id: T.member.id }, dueDate: "2026-12-01" });
    expect(task.url).toContain(`?task=${task.id}`);

    const byRef = await (await taskRoute.GET(req(`/tasks/${task.ref}`, read), params({ id: task.ref }))).json();
    expect(byRef.data.id).toBe(task.id);

    const patched = await taskRoute.PATCH(
      req(`/tasks/${task.id}`, write, { method: "PATCH", body: JSON.stringify({ status: "Done", title: "From CI (done)", expectedVersion: task.version }) }),
      params({ id: task.id })
    );
    expect(patched.status).toBe(200);
    const { data: after } = await patched.json();
    expect(after).toMatchObject({ status: "Done", title: "From CI (done)" });

    const stale = await taskRoute.PATCH(req(`/tasks/${task.id}`, write, { method: "PATCH", body: JSON.stringify({ title: "x", expectedVersion: task.version }) }), params({ id: task.id }));
    expect(stale.status).toBe(409);
    const bad = await taskRoute.PATCH(req(`/tasks/${task.id}`, write, { method: "PATCH", body: JSON.stringify({ priority: "whenever" }) }), params({ id: task.id }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.issues[0].path).toBe("priority");
    const unknownField = await taskRoute.PATCH(req(`/tasks/${task.id}`, write, { method: "PATCH", body: JSON.stringify({ organizationId: Other.org.id }) }), params({ id: task.id }));
    expect(unknownField.status).toBe(400);

    const c = await commentsRoute.POST(req(`/tasks/${task.id}/comments`, write, { method: "POST", body: JSON.stringify({ body: "Deployed by CI" }) }), params({ id: task.id }));
    expect(c.status).toBe(201);
    const comments = await (await commentsRoute.GET(req(`/tasks/${task.id}/comments`, read), params({ id: task.id }))).json();
    expect(comments.data.map((x: { body: string }) => x.body)).toContain("Deployed by CI");

    const list = await (await tasksRoute.GET(req("/projects/ENG/tasks?status=done&limit=1", read), params({ key: "ENG" }))).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].status).toBe("Done");

    expect((await taskRoute.DELETE(req(`/tasks/${task.id}`, write, { method: "DELETE" }), params({ id: task.id }))).status).toBe(204);
    expect((await taskRoute.GET(req(`/tasks/${task.id}`, read), params({ id: task.id }))).status).toBe(404);
  });

  it("can't see or touch another workspace's data", async () => {
    expect((await taskRoute.GET(req(`/tasks/${Other.task.id}`, write), params({ id: Other.task.id }))).status).toBe(404);
    expect((await tasksRoute.GET(req("/projects/ENG/tasks", write), params({ key: "ENG" }))).status).toBe(200);
    const list = await (await tasksRoute.GET(req("/projects/ENG/tasks?limit=200", write), params({ key: "ENG" }))).json();
    expect(list.data.some((t: { id: string }) => t.id === Other.task.id)).toBe(false);
  });

  it("a key loses write access when its owner is demoted to viewer", async () => {
    const { token } = await createApiKey(db, T.admin.id, T.org.id, { name: "demote", scope: "write" });
    await db.update(orgMembers).set({ role: "viewer" }).where(eq(orgMembers.userId, T.admin.id));
    const res = await tasksRoute.POST(req("/projects/ENG/tasks", token, { method: "POST", body: JSON.stringify({ title: "x" }) }), params({ key: "ENG" }));
    expect(res.status).toBe(403);
    await db.update(orgMembers).set({ role: "admin" }).where(eq(orgMembers.userId, T.admin.id));
  });
});

/* ---------------------------------- webhooks ---------------------------------- */

describe("webhooks", () => {
  it("blocks private, loopback, link-local and metadata addresses", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    await expect(assertSafeUrl("http://93.184.216.34/hook")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(assertSafeUrl("https://localhost/hook")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(assertSafeUrl("https://169.254.169.254/latest")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(assertSafeUrl("https://user:pw@93.184.216.34/")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(assertSafeUrl("https://93.184.216.34:22/")).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await assertSafeUrl("https://93.184.216.34/hook")).hostname).toBe("93.184.216.34");
  });

  it("signs like Stripe and rejects tampering or replays", () => {
    const body = JSON.stringify({ a: 1 });
    const header = sign("whsec_test", body, 1_700_000_000);
    expect(verifySignature("whsec_test", body, header, 300, 1_700_000_100)).toBe(true);
    expect(verifySignature("whsec_test", body + " ", header, 300, 1_700_000_100)).toBe(false);
    expect(verifySignature("whsec_other", body, header, 300, 1_700_000_100)).toBe(false);
    expect(verifySignature("whsec_test", body, header, 300, 1_700_009_999)).toBe(false);
  });

  it("delivers signed events to subscribed hooks, records results, and switches off after 15 failures", async () => {
    await expect(createWebhook(db, T.member.id, T.org.id, { url: "https://93.184.216.34/h", events: ["task.created"] })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    const hook = await createWebhook(db, T.admin.id, T.org.id, { url: "https://93.184.216.34/h", events: ["task.created"] });
    expect(hook.secret).toMatch(/^whsec_/);
    const seen: { headers: Record<string, string>; body: string }[] = [];
    const okFetch = async (_url: string, init: RequestInit) => {
      seen.push({ headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response("ok", { status: 200 });
    };
    await dispatchEvent(db, T.org.id, "task.created", { task: { id: "x" } }, okFetch);
    await dispatchEvent(db, T.org.id, "task.deleted", { task: { id: "x" } }, okFetch); // not subscribed
    expect(seen).toHaveLength(1);
    expect(verifySignature(hook.secret, seen[0]!.body, seen[0]!.headers["SyncSprint-Signature"]!)).toBe(true);
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ event: "task.created", organizationId: T.org.id, data: { task: { id: "x" } } });

    const failing = async () => new Response("no", { status: 500 });
    for (let i = 0; i < 15; i++) await deliver(db, (await db.select().from(webhooks).where(eq(webhooks.id, hook.id)))[0]!, "task.created", {}, failing);
    const [after] = await db.select().from(webhooks).where(eq(webhooks.id, hook.id));
    expect(after).toMatchObject({ enabled: false, consecutiveFailures: 15, lastStatus: 500 });
    const deliveries = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id));
    expect(deliveries.filter((d) => !d.ok)).toHaveLength(15);

    const ping = await pingWebhook(db, T.admin.id, T.org.id, hook.id, async () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1" } }));
    expect(ping).toMatchObject({ ok: false, error: "Redirects aren't followed" });
    await expect(pingWebhook(db, Other.owner.id, Other.org.id, hook.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/* ------------------------------------ CSV ------------------------------------ */

describe("CSV import / export", () => {
  it("parses quotes, escaped quotes, newlines in fields and a BOM; neutralises formulas", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n"multi\nline",2\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["multi\nline", "2"]]);
    expect(safeCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(toCsv([["@SUM(A1)", 5, null]])).toContain("'@SUM(A1),5,");
    expect(parseDate("2026-03-12")).toBe("2026-03-12");
    expect(parseDate("12/Mar/26 3:00 PM")).toBe("2026-03-12");
    expect(parseDate("12 March 2026")).toBe("2026-03-12");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("someday")).toBeNull();
  });

  const JIRA = [
    "Issue key,Summary,Issue Type,Status,Priority,Assignee,Labels,Labels,Custom field (Story Points),Original Estimate,Due Date,Parent,Description",
    `ABC-1,Checkout epic,Epic,To Do,Highest,,payments,,8,,,,"Big, important"`,
    `ABC-2,Card form,Story,In Progress,High,{{member}},payments,frontend,3,7200,15/Dec/26 5:00 PM,ABC-1,`,
    `ABC-3,Fix rounding,Bug,Resolved,Minor,someone@else.com,,,1,,,ABC-2,`,
    `ABC-4,,Task,To Do,Low,,,,,,,,`,
    `ABC-5,Weird status,Task,Waiting for vendor,Medium,,,,,,not a date,,`,
  ].join("\n");

  it("previews Jira exports with mapping and per-row warnings, then imports atomically", async () => {
    const project = await createProject(db, T.owner.id, { organizationId: T.org.id, name: "Imported", key: "IMP" });
    const csv = JIRA.replace("{{member}}", T.member.email);
    await expect(previewImport(db, T.viewer.id, T.org.id, project.id, csv)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    const p = await previewImport(db, T.member.id, T.org.id, project.id, csv);
    expect(p.rows).toHaveLength(4);
    expect(p.skipped).toEqual([{ line: 5, reason: "No title" }]);
    const [epic, story, bug, weird] = p.rows;
    expect(epic).toMatchObject({ type: "epic", priority: "urgent", status: "Backlog", storyPoints: 8, labels: ["payments"] });
    expect(story).toMatchObject({ type: "story", status: "In Progress", assigneeId: T.member.id, estimateHours: 2, dueDate: "2026-12-15", labels: ["payments", "frontend"], parentKey: "ABC-1" });
    expect(bug).toMatchObject({ type: "bug", status: "Done", priority: "low", assigneeId: null, parentKey: null });
    expect(bug!.warnings.join()).toMatch(/isn't in this workspace.*Parent ABC-2 is itself a subtask/);
    expect(weird!.warnings.join()).toMatch(/Status "Waiting for vendor" → Backlog.*Couldn't read due date/);

    const { created } = await commitImport(db, T.member.id, T.org.id, project.id, csv);
    expect(created.map((t) => t.taskNumber).sort()).toEqual([1, 2, 3, 4]);
    const card = created.find((t) => t.title === "Card form")!;
    expect(card.parentId).toBe(created.find((t) => t.title === "Checkout epic")!.id);
    const out = await exportProjectCsv(db, T.viewer.id, T.org.id, project.id);
    expect(out.count).toBe(4);
    const table = parseCsv(out.csv);
    expect(table[0]!.slice(0, 3)).toEqual(["Key", "Summary", "Status"]);
    const row = table.find((r) => r[1] === "Card form")!;
    expect(row).toContain("IMP-1"); // parent column
    expect(row[12]).toBe("payments;frontend");

    // Round trip: our own export imports cleanly into another project.
    const again = await createProject(db, T.owner.id, { organizationId: T.org.id, name: "Copy", key: "CPY" });
    const second = await previewImport(db, T.member.id, T.org.id, again.id, out.csv);
    expect(second.rows.map((r) => r.title).sort()).toEqual(["Card form", "Checkout epic", "Fix rounding", "Weird status"]);
    expect(second.rows.every((r) => r.warnings.length === 0)).toBe(true);
  });

  it("refuses files without titles, oversized files and other tenants' projects", async () => {
    await expect(previewImport(db, T.member.id, T.org.id, T.project.id, "Foo,Bar\n1,2")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(previewImport(db, T.member.id, T.org.id, T.project.id, "Summary\n" + "x\n".repeat(1001))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(previewImport(db, T.member.id, T.org.id, Other.project.id, "Summary\nx")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(exportProjectCsv(db, T.member.id, T.org.id, Other.project.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/* ------------------------------- sprint capacity ------------------------------- */

describe("sprint capacity", () => {
  it("available hours from the schedule vs open estimated work, split between assignees", async () => {
    // Mon 2026-11-30 .. Fri 2026-12-04 = 5 working days × 8h
    const s = await createSprint(db, T.admin.id, T.org.id, T.project.id, { name: "Cap", startDate: "2026-11-30", endDate: "2026-12-04" });
    const mk = (title: string, extra: Record<string, unknown>) =>
      createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title, sprintId: s.id, ...extra });
    await mk("Big", { assigneeId: T.member.id, estimateHours: 30 });
    await mk("Shared", { assigneeId: T.member.id, estimateHours: 20 });
    await mk("No estimate", { assigneeId: T.admin.id });
    await mk("Nobody", { estimateHours: 4 });
    const doneTask = await mk("Finished", { assigneeId: T.member.id, estimateHours: 50 });
    await db.update(tasks).set({ columnId: T.columns[T.columns.length - 1]!.id }).where(eq(tasks.id, doneTask.id));

    const cap = await sprintCapacity(db, T.viewer.id, T.org.id, s.id);
    const member = cap.people.find((p) => p.userId === T.member.id)!;
    expect(member).toMatchObject({ availableHours: 40, committedHours: 50, tasks: 2, status: "over" });
    expect(cap.people.find((p) => p.userId === T.admin.id)).toMatchObject({ committedHours: 0, unestimated: 1 });
    expect(cap.totals).toMatchObject({ unassigned: 1, unassignedHours: 4 });
    await expect(sprintCapacity(db, Other.owner.id, Other.org.id, s.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const undated = await createSprint(db, T.admin.id, T.org.id, T.project.id, { name: "Undated" });
    await db.update(sprints).set({ startDate: null, endDate: null }).where(eq(sprints.id, undated.id));
    await expect(sprintCapacity(db, T.admin.id, T.org.id, undated.id)).rejects.toMatchObject({ code: "VALIDATION" });
    void getTask;
  });
});

/* ------------------------------ realtime fan-out ------------------------------ */

describe("realtime fan-out across instances", () => {
  it("delivers locally once, relays to other instances, and reloads oversized task events", async () => {
    let wire: (p: string) => void = () => {};
    const transport = {
      notify: async (p: string) => wire(p),
      listen: async (cb: (p: string) => void) => void (wire = cb),
    };
    const delivered: { who: string; e: OrgEvent }[] = [];
    const big = { id: "t1", title: "x", description: "y".repeat(9000) } as never;
    const mk = (who: string) =>
      createFanout({ transport, deliverLocal: (_o, e) => delivered.push({ who, e }), loadTask: async () => ({ ...(big as object), description: "from db" }) as never });
    const a = mk("a");
    const b = mk("b");
    // One shared "channel": both listen; the last registered listener forwards to both.
    let listeners: ((p: string) => void)[] = [];
    transport.listen = async (cb) => void listeners.push(cb);
    wire = (p) => listeners.forEach((l) => l(p));
    await a.start();
    await b.start();
    listeners = [(p) => void a.receive(p), (p) => void b.receive(p)];

    a.publish("org", { type: "GOALS_CHANGED", actor: { id: "u", name: "U" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(delivered.map((d) => d.who)).toEqual(["a", "b"]); // a locally, b via the channel, a ignores its echo

    delivered.length = 0;
    a.publish("org", { type: "TASK_UPDATED", actor: { id: "u", name: "U" }, task: big, action: "edited" });
    await new Promise((r) => setTimeout(r, 0));
    const remote = delivered.find((d) => d.who === "b")!.e as Extract<OrgEvent, { type: "TASK_UPDATED" }>;
    expect(remote.task.description).toBe("from db");
    expect(remote.action).toBe("edited");
  });
});
