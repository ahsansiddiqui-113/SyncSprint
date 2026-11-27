import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { boardColumns, notifications, taskComments, taskWatchers } from "@/db/schema";
import { requireOrgPermission } from "@/lib/rbac";
import { isBillableRole } from "@/lib/billing-rules";
import * as guests from "@/server/services/guests";
import { createProject, createInvite, changeMemberRole, listProjects } from "@/server/services/workspace";
import { createTask, listComments } from "@/server/services/tasks";
import { searchWorkspace } from "@/server/services/onboarding";
import { addMember, makeTenant, makeUser, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;
let guest: Awaited<ReturnType<typeof makeUser>>;
let secret: Awaited<ReturnType<typeof createProject>>;

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Host");
  Other = await makeTenant("Elsewhere");
  guest = await makeUser("Client Guest");
  await addMember(T.org.id, guest.id, "guest");
  secret = await createProject(db, T.owner.id, { organizationId: T.org.id, name: "Internal", key: "INT" });
});

describe("guests", () => {
  it("are free, can be invited and role-changed, and pass no regular role check", async () => {
    expect(isBillableRole("guest")).toBe(false);
    await createInvite(db, T.owner.id, { organizationId: T.org.id, email: "contractor@client.example", role: "guest" });
    await expect(requireOrgPermission(guest.id, T.org.id, "viewer", db)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_VIEWER" });
    await expect(listProjects(db, guest.id, T.org.slug)).rejects.toBeTruthy();
    await expect(searchWorkspace(db, guest.id, T.org.id, "task")).rejects.toBeTruthy();
    await expect(listComments(db, guest.id, T.org.id, T.task.id)).rejects.toBeTruthy();
    expect(await requireOrgPermission(guest.id, T.org.id, "guest", db)).toBe("guest");
    await expect(requireOrgPermission(guest.id, Other.org.id, "guest", db)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });

  it("see only the projects they're added to", async () => {
    expect(await guests.guestProjects(db, guest.id, T.org.id)).toEqual([]);
    await expect(guests.guestProjectView(db, guest.id, T.org.id, "ENG")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(guests.setGuestProject(db, T.member.id, T.org.id, guest.id, T.project.id, true)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(guests.setGuestProject(db, T.owner.id, T.org.id, T.member.id, T.project.id, true)).rejects.toThrow(/Only guests/);
    await expect(guests.setGuestProject(db, T.owner.id, T.org.id, guest.id, Other.project.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await guests.setGuestProject(db, T.owner.id, T.org.id, guest.id, T.project.id, true);
    const list = await guests.guestProjects(db, guest.id, T.org.id);
    expect(list.map((p) => p.key)).toEqual(["ENG"]);
    const view = await guests.guestProjectView(db, guest.id, T.org.id, "eng");
    expect(view.tasks.map((t) => t.id)).toContain(T.task.id);
    expect(JSON.stringify(view)).not.toMatch(/@test\.local/); // no emails
    await expect(guests.guestProjectView(db, guest.id, T.org.id, "INT")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const access = await guests.listGuestAccess(db, T.owner.id, T.org.id);
    expect(access.find((g) => g.userId === guest.id)?.projectIds).toEqual([T.project.id]);
    void secret;
  });

  it("comment only inside their projects; assignee and watchers are told", async () => {
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Logo options", assigneeId: T.admin.id });
    await db.insert(taskWatchers).values({ organizationId: T.org.id, taskId: t.id, userId: T.viewer.id });
    const r = await guests.guestComment(db, guest.id, T.org.id, t.id, "I prefer option B");
    expect(r.notified.sort()).toEqual([T.admin.id, T.viewer.id].sort());
    expect((await db.select().from(taskComments).where(eq(taskComments.taskId, t.id)))[0]!.body).toBe("I prefer option B");
    expect((await db.select().from(notifications).where(eq(notifications.taskId, t.id))).some((n) => n.title.includes("(guest)"))).toBe(true);
    // A task in a project they can't see.
    const [intCol] = await db.select().from(boardColumns).where(eq(boardColumns.projectId, secret.id)).limit(1);
    const internal = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: intCol!.id, title: "Salary review" });
    await expect(guests.guestComment(db, guest.id, T.org.id, internal.id, "peek")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(guests.guestComment(db, guest.id, Other.org.id, Other.task.id, "x")).rejects.toBeTruthy();
  });

  it("lose project access when removed, and everything when made a guest", async () => {
    await guests.setGuestProject(db, T.owner.id, T.org.id, guest.id, T.project.id, false);
    expect(await guests.guestProjects(db, guest.id, T.org.id)).toEqual([]);
    await changeMemberRole(db, T.owner.id, { organizationId: T.org.id, userId: T.viewer.id, role: "guest" });
    await expect(requireOrgPermission(T.viewer.id, T.org.id, "viewer", db)).rejects.toBeTruthy();
    expect(await guests.guestProjects(db, T.viewer.id, T.org.id)).toEqual([]);
  });
});
