import { beforeAll, describe, expect, it } from "vitest";
import { can, hasRole, requireOrgPermission } from "@/lib/rbac";
import { createTask, deleteTask, moveTask, updateTask, addComment } from "@/server/services/tasks";
import { changeMemberRole, createInvite, createProject, acceptInvite, removeMember } from "@/server/services/workspace";
import { decomposeTask } from "@/server/ai/features";
import { switchDemoRole } from "@/server/services/demo";
import { getTask, makeTenant, makeUser, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Rbac");
});

describe("role hierarchy", () => {
  it("orders owner > admin > member > viewer", () => {
    expect(hasRole("owner", "admin")).toBe(true);
    expect(hasRole("admin", "owner")).toBe(false);
    expect(hasRole("member", "viewer")).toBe(true);
    expect(hasRole("viewer", "member")).toBe(false);
    expect(can("member", "CREATE_OR_MOVE_TASK")).toBe(true);
    expect(can("viewer", "CREATE_OR_MOVE_TASK")).toBe(false);
    expect(can(null, "VIEW_BOARD")).toBe(false);
  });

  it("returns the caller's role when allowed", async () => {
    await expect(requireOrgPermission(T.admin.id, T.org.id, "member", db)).resolves.toBe("admin");
  });
});

describe("viewer is read-only on the server", () => {
  it("cannot move tasks", async () => {
    await expect(
      moveTask(db, T.viewer.id, { organizationId: T.org.id, taskId: T.task.id, targetColumnId: T.columns[1]!.id, newPosition: 5, expectedVersion: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    expect((await getTask(T.task.id))!.version).toBe(1);
  });

  it("cannot create, edit, delete, comment or use AI", async () => {
    const forbidden = { code: "FORBIDDEN_REQUIRES_MEMBER" };
    await expect(createTask(db, T.viewer.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "x" })).rejects.toMatchObject(forbidden);
    await expect(updateTask(db, T.viewer.id, { organizationId: T.org.id, taskId: T.task.id, expectedVersion: 1, patch: { title: "x" } })).rejects.toMatchObject(forbidden);
    await expect(deleteTask(db, T.viewer.id, T.org.id, T.task.id)).rejects.toMatchObject(forbidden);
    await expect(addComment(db, T.viewer.id, T.org.id, T.task.id, "hi")).rejects.toMatchObject(forbidden);
    await expect(decomposeTask(db, T.viewer.id, T.org.id, T.task.id)).rejects.toMatchObject(forbidden);
  });
});

describe("member", () => {
  it("can move tasks", async () => {
    const res = await moveTask(db, T.member.id, { organizationId: T.org.id, taskId: T.task.id, targetColumnId: T.columns[1]!.id, newPosition: 1024, expectedVersion: 1 });
    expect(res.ok).toBe(true);
  });

  it("cannot change roles, invite, or create projects", async () => {
    await expect(changeMemberRole(db, T.member.id, { organizationId: T.org.id, userId: T.viewer.id, role: "admin" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(createInvite(db, T.member.id, { organizationId: T.org.id, email: "someone@example.com", role: "member" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(createProject(db, T.member.id, { organizationId: T.org.id, name: "Nope", key: "NOPE" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
  });

  it("cannot escalate their own role", async () => {
    await expect(changeMemberRole(db, T.member.id, { organizationId: T.org.id, userId: T.member.id, role: "owner" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
  });
});

describe("admin vs owner rules", () => {
  it("admin can change member ↔ viewer", async () => {
    await expect(changeMemberRole(db, T.admin.id, { organizationId: T.org.id, userId: T.viewer.id, role: "member" })).resolves.toEqual({ from: "viewer", to: "member" });
    await changeMemberRole(db, T.admin.id, { organizationId: T.org.id, userId: T.viewer.id, role: "viewer" });
  });

  it("admin cannot grant ownership or touch an owner", async () => {
    await expect(changeMemberRole(db, T.admin.id, { organizationId: T.org.id, userId: T.member.id, role: "owner" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_OWNER" });
    await expect(changeMemberRole(db, T.admin.id, { organizationId: T.org.id, userId: T.owner.id, role: "viewer" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_OWNER" });
    await expect(removeMember(db, T.admin.id, T.org.id, T.owner.id)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_OWNER" });
  });

  it("the last owner can never be demoted or leave", async () => {
    await expect(changeMemberRole(db, T.owner.id, { organizationId: T.org.id, userId: T.owner.id, role: "admin" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(removeMember(db, T.owner.id, T.org.id, T.owner.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("demo role switching is refused outside demo workspaces", async () => {
    await expect(switchDemoRole(db, T.member.id, T.org.id, "owner")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("invites", () => {
  it("are bound to the invited email and single-use", async () => {
    const invitee = await makeUser("Invitee");
    const stranger = await makeUser("Stranger");
    const invite = await createInvite(db, T.admin.id, { organizationId: T.org.id, email: invitee.email, role: "viewer" });

    await expect(acceptInvite(db, stranger.id, invite.token)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(acceptInvite(db, invitee.id, invite.token)).resolves.toMatchObject({ id: T.org.id });
    await expect(requireOrgPermission(invitee.id, T.org.id, "viewer", db)).resolves.toBe("viewer");
    await expect(acceptInvite(db, invitee.id, invite.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("admins cannot mint owner invites", async () => {
    await expect(createInvite(db, T.admin.id, { organizationId: T.org.id, email: "boss@x.io", role: "owner" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_OWNER" });
  });
});
