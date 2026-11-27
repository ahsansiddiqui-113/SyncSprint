import { beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { boardColumns, chatChannels, devLinks, notifications, outbox, tasks, users } from "@/db/schema";
import { seal, unseal } from "@/lib/seal";
import * as chat from "@/server/services/chat";
import * as out from "@/server/services/outbound";
import * as inbound from "@/server/services/inbound-email";
import * as dev from "@/server/services/devlinks";
import { createTask } from "@/server/services/tasks";
import { notify } from "@/server/services/notifications";
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;
const SLACK = "https://hooks.slack.com/services/T000/B000/abcdefSECRET";

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Reach");
  Other = await makeTenant("Faraway");
});

describe("sealed secrets", () => {
  it("round-trips and detects tampering", () => {
    const s = seal("hello");
    expect(s).not.toContain("hello");
    expect(unseal(s)).toBe("hello");
    expect(() => unseal(s.slice(0, -2) + "xx")).toThrow();
  });
});

describe("chat alerts", () => {
  it("only accepts the provider's own webhook hosts", () => {
    expect(chat.validateChatUrl("slack", SLACK)).toBe(SLACK);
    expect(() => chat.validateChatUrl("slack", "https://evil.example/services/x")).toThrow(/Slack/);
    expect(() => chat.validateChatUrl("slack", "http://hooks.slack.com/services/x")).toThrow(/https/);
    expect(() => chat.validateChatUrl("discord", "https://discord.com/api/webhooks/1/abc")).not.toThrow();
    expect(() => chat.validateChatUrl("teams", "https://acme.webhook.office.com/webhookb2/x")).not.toThrow();
    expect(() => chat.validateChatUrl("google_chat", "https://chat.googleapis.com/v1/spaces/AAA/messages?key=1")).not.toThrow();
    expect(() => chat.validateChatUrl("teams", "https://169.254.169.254/latest")).toThrow();
  });

  it("stores the URL encrypted, posts formatted messages per project, and turns off after repeated failures", async () => {
    await expect(chat.createChannel(db, T.member.id, T.org.id, { kind: "slack", name: "#x", url: SLACK, events: ["task.created"] })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await chat.createChannel(db, T.owner.id, T.org.id, { kind: "slack", name: "#eng", url: SLACK, projectId: T.project.id, events: ["task.created", "task.status"] });
    await chat.createChannel(db, T.owner.id, T.org.id, { kind: "discord", name: "all", url: "https://discord.com/api/webhooks/1/abc", events: ["comment.created"] });
    const listed = await chat.listChannels(db, T.owner.id, T.org.id);
    expect(JSON.stringify(listed)).not.toContain("abcdefSECRET");
    const [row] = await db.select().from(chatChannels).where(eq(chatChannels.name, "#eng"));
    expect(row!.urlSealed).not.toContain("hooks.slack.com");

    const sent: { url: string; body: any }[] = [];
    const ok = async (url: string, init: RequestInit) => (sent.push({ url, body: JSON.parse(String(init.body)) }), { ok: true, status: 200 });
    const payload = { task: { ref: "ENG-9", title: "Ship it", url: "https://app/x", status: "Done", priority: "high", assignee: { name: "Ana" } }, changes: ["status"] };
    expect(await chat.chatFromEvent(db, T.org.id, "task.updated", payload, ok)).toBe(1);
    expect(sent[0]!.url).toBe(SLACK);
    expect(sent[0]!.body.blocks[0].text.text).toContain("ENG-9 moved to Done");
    // A project the channel doesn't follow gets nothing (key unknown → workspace-wide channels only).
    expect(await chat.chatFromEvent(db, T.org.id, "task.created", { task: { ...payload.task, ref: "ZZZ-1" } }, ok)).toBe(0);
    // Other tenants never see these channels.
    expect(await chat.chatFromEvent(db, Other.org.id, "task.updated", payload, ok)).toBe(0);

    const fail = async () => ({ ok: false, status: 500 });
    for (let i = 0; i < 10; i++) await chat.deliverChat(db, T.org.id, T.project.id, "task.created", { title: "t", text: "x", url: "u", color: "#000000" }, fail);
    const [after] = await db.select().from(chatChannels).where(eq(chatChannels.name, "#eng"));
    expect(after!.enabled).toBe(false);
    expect(after!.lastError).toBe("HTTP 500");
    expect(chat.formatFor("teams", { title: "a", text: "b", url: "c", color: "#7b68ee" })).toMatchObject({ type: "message" });
  });
});

describe("email, push preferences, digests and the calendar feed", () => {
  it("validates preferences and fans notifications out once, by preference", async () => {
    await expect(out.setPrefs(db, T.member.id, T.org.id, { emailInstant: true, digest: "off", push: false, whatsapp: true, whatsappPhone: "0300 123" })).rejects.toThrow(/international/);
    await expect(out.setPrefs(db, Other.member.id, T.org.id, { emailInstant: true, digest: "off", push: false, whatsapp: false, whatsappPhone: null })).rejects.toBeTruthy();
    await out.setPrefs(db, T.member.id, T.org.id, { emailInstant: true, digest: "daily", push: false, whatsapp: true, whatsappPhone: "+923001234567" });
    await db.update(users).set({ email: `member-${Date.now()}@reach.example` }).where(eq(users.id, T.member.id));
    await out.fanOutNotifications(db, new Date(Date.now() - 1000)); // sets the watermark
    await notify(db, T.org.id, T.owner.id, [{ userId: T.member.id, kind: "mention", title: "You were mentioned", link: "/w/x" }]);
    const r = await out.fanOutNotifications(db, new Date(Date.now() + 1000));
    expect(r).toMatchObject({ email: 1, whatsapp: 1 });
    const again = await out.fanOutNotifications(db, new Date(Date.now() + 2000));
    expect(again.notifications).toBe(0);
    const mail = await db.select().from(outbox).where(eq(outbox.channel, "email"));
    expect(mail.some((m) => m.subject.includes("You were mentioned") && m.status === "logged")).toBe(true);
  });

  it("sends a digest only when there's something to say", async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Late thing", assigneeId: T.member.id, dueDate: yesterday });
    const before = (await db.select().from(outbox)).length;
    expect(await out.sendDigests(db)).toBe(1);
    const mail = (await db.select().from(outbox)).slice(before);
    expect(mail[0]!.body).toContain("Late thing");
    expect(await out.sendDigests(db)).toBe(0); // not again within the day
  });

  it("serves a private ICS feed that stops working after a new link", async () => {
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Launch, review; ship", assigneeId: T.member.id, dueDate: due });
    const token = await out.rotateCalendarFeed(db, T.member.id);
    const ics = await out.calendarIcs(db, token);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain(`DTSTART;VALUE=DATE:${due.replace(/-/g, "")}`);
    expect(ics).toContain("Launch\\, review\\; ship");
    expect(ics!.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const fresh = await out.rotateCalendarFeed(db, T.member.id);
    expect(await out.calendarIcs(db, token)).toBeNull();
    expect(await out.calendarIcs(db, fresh)).toContain("VEVENT");
    expect(await out.calendarIcs(db, "x")).toBeNull();
  });
});

describe("email to task", () => {
  it("parses provider payloads and strips quoted replies", () => {
    expect(inbound.normalizeInbound({ From: "Ana <ana@x.example>", ToFull: [{ Email: "eng-abc@in.example" }], Subject: "Hi", TextBody: "Body" })).toEqual({ from: "ana@x.example", to: ["eng-abc@in.example"], subject: "Hi", text: "Body" });
    expect(inbound.normalizeInbound({ from: "a@b.example", to: "c@d.example", subject: "s", text: "t" })?.to).toEqual(["c@d.example"]);
    expect(inbound.normalizeInbound({ subject: "no addresses" })).toBeNull();
    expect(inbound.cleanBody("Please fix\n\nOn Mon, Bob wrote:\n> old stuff")).toBe("Please fix");
    expect(inbound.cleanBody("Thanks\n-- \nSignature")).toBe("Thanks");
  });

  it("creates a task as the member who sent it; strangers and wrong tokens are refused", async () => {
    process.env.INBOUND_EMAIL_DOMAIN = "in.example";
    await expect(inbound.rotateInboundAddress(db, T.member.id, T.org.id, T.project.id, true)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    const a = await inbound.rotateInboundAddress(db, T.owner.id, T.org.id, T.project.id, true);
    expect(a.address).toMatch(/^eng-[a-z0-9]{12}@in\.example$/);
    const [member] = await db.select().from(users).where(eq(users.id, T.member.id));
    const r = await inbound.handleInbound(db, { from: member!.email.toUpperCase(), to: [a.address!], subject: "Fwd: Printer is broken", text: "It jams.\n\nOn Tue, X wrote:\n> earlier" });
    expect(r.task).toMatchObject({ title: "Printer is broken", description: "It jams." });
    await expect(inbound.handleInbound(db, { from: "stranger@spam.example", to: [a.address!], subject: "Buy", text: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(inbound.handleInbound(db, { from: member!.email, to: ["eng-000000000000@in.example"], subject: "x", text: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [otherMember] = await db.select().from(users).where(eq(users.id, Other.member.id));
    await expect(inbound.handleInbound(db, { from: otherMember!.email, to: [a.address!], subject: "x", text: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await inbound.rotateInboundAddress(db, T.owner.id, T.org.id, T.project.id, false);
    await expect(inbound.handleInbound(db, { from: member!.email, to: [a.address!], subject: "x", text: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("GitHub / GitLab links", () => {
  it("finds references and closing keywords", () => {
    expect(dev.findRefs("feat: eng-12 and OPS-3, see ENG-12")).toEqual(["ENG-12", "OPS-3"]);
    expect(dev.findClosing("Fixes ENG-1, closes ENG-2 and ENG-3; mentions ENG-4")).toEqual(["ENG-1", "ENG-2", "ENG-3"]);
  });

  it("verifies signatures, links commits and PRs, and closes on merged 'fixes'", async () => {
    const { id, secret } = await dev.createConnection(db, T.owner.id, T.org.id, { provider: "github", name: "acme/web", autoClose: true });
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[1]!.id, title: "Fix login", assigneeId: T.member.id });
    const ref = `ENG-${t.taskNumber}`;
    const push = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "acme/web", html_url: "https://github.com/acme/web" }, commits: [{ id: "abc123", url: "https://github.com/acme/web/commit/abc123", message: `${ref}: handle expired sessions`, author: { username: "ana" } }] });
    const sig = (b: string, s = secret) => `sha256=${createHmac("sha256", s).update(b).digest("hex")}`;
    await expect(dev.verifyAndLoad(db, "github", id, new Headers({ "x-hub-signature-256": sig(push, "wrong") }), push)).rejects.toMatchObject({ status: 401 });
    const conn = await dev.verifyAndLoad(db, "github", id, new Headers({ "x-hub-signature-256": sig(push) }), push);
    let r = await dev.applyDevItems(db, conn, dev.parseGithub("push", JSON.parse(push)));
    expect(r.linked).toHaveLength(1);
    expect(r.closed).toHaveLength(0); // a push never closes

    const pr = { action: "closed", repository: { full_name: "acme/web" }, pull_request: { number: 7, title: "Session fixes", body: `Fixes ${ref}`, html_url: "https://github.com/acme/web/pull/7", merged: true, state: "closed", head: { ref: "fix/login" }, user: { login: "ana" } } };
    r = await dev.applyDevItems(db, conn, dev.parseGithub("pull_request", pr));
    expect(r.closed.map((x) => x.id)).toEqual([t.id]);
    const last = (await db.select().from(boardColumns).where(eq(boardColumns.projectId, T.project.id))).sort((a, b) => b.position - a.position)[0]!;
    expect((await getTask(t.id))!.columnId).toBe(last.id);
    const links = await dev.listDevLinks(db, T.viewer.id, T.org.id, t.id);
    expect(links.map((l) => `${l.kind}:${l.state}`).sort()).toEqual(["commit:pushed", "pull_request:merged"]);
    expect((await db.select().from(notifications).where(and(eq(notifications.taskId, t.id), eq(notifications.kind, "dev")))).length).toBe(1);

    // Re-delivery updates instead of duplicating; another tenant's ENG-n is never touched.
    await dev.applyDevItems(db, conn, dev.parseGithub("pull_request", pr));
    expect(await db.select().from(devLinks).where(eq(devLinks.taskId, t.id))).toHaveLength(2);
    const otherTask = await createTask(db, Other.member.id, { organizationId: Other.org.id, columnId: Other.columns[0]!.id, title: "Theirs" });
    await dev.applyDevItems(db, conn, dev.parseGithub("pull_request", { ...pr, pull_request: { ...pr.pull_request, number: 8, body: `Fixes ENG-${otherTask.taskNumber}` } }));
    expect(await db.select().from(devLinks).where(eq(devLinks.taskId, otherTask.id))).toHaveLength(0);
  });

  it("GitLab uses its token header; disabled connections do nothing", async () => {
    const { id, secret } = await dev.createConnection(db, T.owner.id, T.org.id, { provider: "gitlab", name: "acme/api", autoClose: false });
    await expect(dev.verifyAndLoad(db, "gitlab", id, new Headers({ "x-gitlab-token": "nope" }), "{}")).rejects.toMatchObject({ status: 401 });
    await expect(dev.verifyAndLoad(db, "github", id, new Headers(), "{}")).rejects.toMatchObject({ status: 404 }); // wrong provider path
    const conn = await dev.verifyAndLoad(db, "gitlab", id, new Headers({ "x-gitlab-token": secret }), "{}");
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "API thing" });
    const mr = { object_kind: "merge_request", project: { path_with_namespace: "acme/api" }, user: { username: "bo" }, object_attributes: { iid: 3, title: `ENG-${t.taskNumber} add endpoint`, description: `Closes ENG-${t.taskNumber}`, state: "merged", url: "https://gitlab.com/acme/api/-/merge_requests/3", source_branch: "x" } };
    const r = await dev.applyDevItems(db, conn, dev.parseGitlab(mr));
    expect(r.linked).toHaveLength(1);
    expect(r.closed).toHaveLength(0); // auto-close off
    await dev.updateConnection(db, T.owner.id, T.org.id, id, { autoClose: true, enabled: false });
    const off = await dev.verifyAndLoad(db, "gitlab", id, new Headers({ "x-gitlab-token": secret }), "{}");
    expect((await dev.applyDevItems(db, off, dev.parseGitlab(mr))).linked).toHaveLength(0);
    void tasks;
  });
});
