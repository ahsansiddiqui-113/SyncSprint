import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { notifications, organizations, shareLinks } from "@/db/schema";
import { createTeam, deleteTeam, listTeams, teamStats, toHandle, updateTeam } from "@/server/services/teams";
import { addComment, createTask, moveTask, updateTask } from "@/server/services/tasks";
import { addManualEntry } from "@/server/services/time-tracking";
import { createAutomation } from "@/server/services/automations";
import { newEffects } from "@/server/services/task-effects";
import { checkSharePassword, createShareLink, listShareLinks, resolveShare, revokeShareLink, sharedView } from "@/server/services/share-links";
import { extractMentions } from "@/server/services/notifications";
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Groups");
  Other = await makeTenant("Elsewhere");
});

describe("groups", () => {
  it("admins create groups with unique names and @handles; everyone in it must be in the workspace", async () => {
    expect(toHandle("Quality Assurance!")).toBe("quality-assurance");
    await expect(createTeam(db, T.member.id, T.org.id, { name: "QA" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(createTeam(db, T.admin.id, T.org.id, { name: "QA", memberIds: [Other.member.id] })).rejects.toMatchObject({ code: "VALIDATION" });
    const qa = await createTeam(db, T.admin.id, T.org.id, { name: "QA", leadId: T.member.id, memberIds: [T.viewer.id] });
    expect(qa).toMatchObject({ handle: "qa", leadId: T.member.id });
    await expect(createTeam(db, T.admin.id, T.org.id, { name: "qa" })).rejects.toMatchObject({ code: "CONFLICT" });
    const [listed] = (await listTeams(db, T.viewer.id, T.org.id)).filter((t) => t.id === qa.id);
    expect(new Set(listed!.memberIds)).toEqual(new Set([T.member.id, T.viewer.id])); // the lead is always a member
    expect(await listTeams(db, Other.owner.id, Other.org.id)).toEqual([]);
  });

  it("a group's lead manages its members but not who leads it; other members can't change it", async () => {
    const [qa] = (await listTeams(db, T.admin.id, T.org.id)).filter((t) => t.handle === "qa");
    await updateTeam(db, T.member.id, T.org.id, qa!.id, { memberIds: [T.admin.id], description: "Testing and release checks" });
    await expect(updateTeam(db, T.member.id, T.org.id, qa!.id, { leadId: T.admin.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateTeam(db, T.viewer.id, T.org.id, qa!.id, { name: "Hack" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    const dev = await createTeam(db, T.admin.id, T.org.id, { name: "Developers" });
    await expect(updateTeam(db, T.member.id, T.org.id, dev.id, { memberIds: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await deleteTeam(db, T.admin.id, T.org.id, dev.id);
  });

  it("tasks can be assigned to a group (same workspace only) and show up in its queue", async () => {
    const [qa] = (await listTeams(db, T.admin.id, T.org.id)).filter((t) => t.handle === "qa");
    const foreign = await createTeam(db, Other.owner.id, Other.org.id, { name: "Foreign" });
    await expect(createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "x", teamId: foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Regression pass", teamId: qa!.id, dueDate: "2020-01-01" });
    const stats = await teamStats(db, T.viewer.id, T.org.id, qa!.id, "2026-11-26");
    expect(stats.queue.map((q) => q.id)).toContain(t.id);
    expect(stats.overdue).toBeGreaterThanOrEqual(1);
    // Someone takes it: it leaves the unassigned queue.
    const r = await updateTask(db, T.member.id, { organizationId: T.org.id, taskId: t.id, expectedVersion: t.version, patch: { assigneeId: T.admin.id } });
    expect(r.ok).toBe(true);
    expect((await teamStats(db, T.viewer.id, T.org.id, qa!.id, "2026-11-26")).queue.map((q) => q.id)).not.toContain(t.id);
  });

  it("tracking: finished work per week and hours logged per member", async () => {
    const [qa] = (await listTeams(db, T.admin.id, T.org.id)).filter((t) => t.handle === "qa");
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Ship check", assigneeId: T.member.id });
    await moveTask(db, T.member.id, { organizationId: T.org.id, taskId: t.id, targetColumnId: T.columns.at(-1)!.id, newPosition: 9, expectedVersion: t.version });
    const today = new Date().toISOString().slice(0, 10);
    await addManualEntry(db, T.member.id, T.org.id, { taskId: t.id, minutes: 90, date: today });
    const stats = await teamStats(db, T.admin.id, T.org.id, qa!.id, today);
    expect(stats.weeks.at(-1)!.done).toBeGreaterThanOrEqual(1);
    expect(stats.members.find((m) => m.id === T.member.id)!.hoursThisWeek).toBe(1.5);
    await expect(teamStats(db, Other.owner.id, Other.org.id, qa!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("@group mentions notify every member (not the author); other workspaces' groups are ignored", async () => {
    const [qa] = (await listTeams(db, T.admin.id, T.org.id)).filter((t) => t.handle === "qa");
    const foreign = (await listTeams(db, Other.owner.id, Other.org.id))[0]!;
    const body = `@[QA](team:${qa!.id}) please verify, and @[Foreign](team:${foreign.id})`;
    expect(extractMentions(body)).toEqual([`team:${qa!.id}`, `team:${foreign.id}`]);
    const c = await addComment(db, T.admin.id, T.org.id, T.task.id, body);
    expect(new Set(c.notified)).toEqual(new Set([T.member.id])); // QA = lead (member) + admin (the author)
    const kinds = await db.select().from(notifications).where(and(eq(notifications.userId, T.member.id), eq(notifications.taskId, T.task.id)));
    expect(kinds.some((n) => n.kind === "mention")).toBe(true);
  });

  it("automations: 'group is' condition and 'send to group' action", async () => {
    const [qa] = (await listTeams(db, T.admin.id, T.org.id)).filter((t) => t.handle === "qa");
    await createAutomation(db, T.admin.id, T.org.id, T.project.id, {
      name: "Bugs to QA", trigger: { kind: "task_created" }, conditions: [{ field: "type", op: "is", value: "bug" }], actions: [{ type: "assign_to_team", teamId: qa!.id }],
    });
    await expect(
      createAutomation(db, T.admin.id, T.org.id, T.project.id, { name: "bad", trigger: { kind: "task_created" }, actions: [{ type: "assign_to_team", teamId: (await listTeams(db, Other.owner.id, Other.org.id))[0]!.id }] })
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const bug = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Crash", type: "bug" }, newEffects());
    expect(bug.teamId).toBe(qa!.id);
    expect((await getTask(bug.id))!.teamId).toBe(qa!.id);
  });
});

describe("share links", () => {
  it("admins only; one project by default; whole workspace only on purpose; the URL token is shown once and stored hashed", async () => {
    await expect(createShareLink(db, T.member.id, T.org.id, { scope: "project", projectId: T.project.id, label: "Client" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(createShareLink(db, T.admin.id, T.org.id, { scope: "project", label: "No project" })).rejects.toThrow();
    await expect(createShareLink(db, T.admin.id, T.org.id, { scope: "project", projectId: Other.project.id, label: "Theirs" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { token, link } = await createShareLink(db, T.admin.id, T.org.id, { scope: "project", projectId: T.project.id, label: "Acme client" });
    const [stored] = await db.select().from(shareLinks).where(eq(shareLinks.id, link.id));
    expect(stored!.tokenHash).not.toContain(token);
    const share = await resolveShare(db, token);
    expect(share?.link.id).toBe(link.id);
    const view = await sharedView(db, share!);
    expect(view.project?.key).toBe("ENG");
    expect(view.tasks!.length).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toMatch(/@test\.local/); // no emails anywhere
    expect(view.tasks![0]!.comments).toEqual([]); // comments off by default
    const listed = await listShareLinks(db, T.admin.id, T.org.id);
    expect(listed.find((l) => l.id === link.id)).toMatchObject({ viewCount: 1, projectKey: "ENG" });
  });

  it("revoked, expired, garbage tokens and locked workspaces all look the same: unavailable", async () => {
    const a = await createShareLink(db, T.admin.id, T.org.id, { scope: "workspace", label: "Board", includeComments: true });
    const view = await sharedView(db, (await resolveShare(db, a.token))!, "eng");
    expect(view.scope).toBe("workspace");
    expect(view.project?.key).toBe("ENG");
    await revokeShareLink(db, T.admin.id, T.org.id, a.link.id);
    expect(await resolveShare(db, a.token)).toBeNull();
    expect(await resolveShare(db, "not-a-token")).toBeNull();
    const b = await createShareLink(db, T.admin.id, T.org.id, { scope: "project", projectId: T.project.id, label: "Temp", expiresInDays: 1 });
    await db.update(shareLinks).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(shareLinks.id, b.link.id));
    expect(await resolveShare(db, b.token)).toBeNull();
    const c = await createShareLink(db, T.admin.id, T.org.id, { scope: "project", projectId: T.project.id, label: "Locked" });
    await db.update(organizations).set({ billingStatus: "suspended", suspendedAt: new Date() }).where(eq(organizations.id, T.org.id));
    expect(await resolveShare(db, c.token)).toBeNull();
    await db.update(organizations).set({ billingStatus: "trialing", suspendedAt: null }).where(eq(organizations.id, T.org.id));
    expect(await resolveShare(db, c.token)).not.toBeNull();
    await expect(revokeShareLink(db, Other.owner.id, Other.org.id, c.link.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("password: right password works, wrong ones are limited to 10 tries per 15 minutes", async () => {
    await expect(createShareLink(db, T.admin.id, T.org.id, { scope: "project", projectId: T.project.id, label: "Short", password: "123" })).rejects.toThrow();
    const { token } = await createShareLink(db, T.admin.id, T.org.id, { scope: "project", projectId: T.project.id, label: "Locked", password: "s3cret-pass" });
    const share = (await resolveShare(db, token))!;
    expect(share.link.passwordHash).toMatch(/^scrypt\$/);
    expect(checkSharePassword(share.link, "wrong")).toBe("wrong");
    expect(checkSharePassword(share.link, "s3cret-pass")).toBe("ok");
    for (let i = 0; i < 10; i++) checkSharePassword(share.link, "nope");
    expect(checkSharePassword(share.link, "s3cret-pass")).toBe("limited");
  });
});
