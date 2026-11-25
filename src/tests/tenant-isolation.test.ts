import { beforeAll, describe, expect, it } from "vitest";
import { requireOrgBySlug, requireOrgPermission } from "@/lib/rbac";
import { createTask, moveTask, updateTask, listComments } from "@/server/services/tasks";
import { getBoard, listAuditLogs, listMembers } from "@/server/services/workspace";
import { sprintDigest } from "@/server/ai/features";
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  db = await testDb();
  A = await makeTenant("Alpha");
  B = await makeTenant("Bravo");
});

describe("cross-tenant isolation", () => {
  it("rejects a user of Org A querying Org B with FORBIDDEN_NOT_A_MEMBER", async () => {
    await expect(requireOrgPermission(A.owner.id, B.org.id, "viewer", db)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });

  it("hides other tenants behind the same error whether the slug exists or not", async () => {
    await expect(requireOrgBySlug(A.owner.id, B.org.slug, "viewer", db)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    await expect(requireOrgBySlug(A.owner.id, "does-not-exist", "viewer", db)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });

  it("blocks reads of another tenant's board, members, audit log, comments and AI digest", async () => {
    await expect(getBoard(db, A.owner.id, B.org.slug, "ENG")).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    await expect(listMembers(db, A.owner.id, B.org.id)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    await expect(listAuditLogs(db, A.owner.id, B.org.id)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    await expect(listComments(db, A.owner.id, B.org.id, B.task.id)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
    await expect(sprintDigest(db, A.owner.id, B.org.id, B.project.id)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });

  it("blocks mutations that claim Org B directly", async () => {
    await expect(
      moveTask(db, A.owner.id, { organizationId: B.org.id, taskId: B.task.id, targetColumnId: B.columns[1]!.id, newPosition: 10, expectedVersion: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });

  it("blocks id smuggling: own orgId + another tenant's task/column ids", async () => {
    // Passes the membership check (A's own org) but targets B's rows.
    await expect(
      moveTask(db, A.owner.id, { organizationId: A.org.id, taskId: B.task.id, targetColumnId: A.columns[1]!.id, newPosition: 10, expectedVersion: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      moveTask(db, A.owner.id, { organizationId: A.org.id, taskId: A.task.id, targetColumnId: B.columns[1]!.id, newPosition: 10, expectedVersion: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createTask(db, A.owner.id, { organizationId: A.org.id, columnId: B.columns[0]!.id, title: "sneaky" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateTask(db, A.owner.id, { organizationId: A.org.id, taskId: B.task.id, expectedVersion: 1, patch: { title: "pwned" } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const untouched = await getTask(B.task.id);
    expect(untouched).toMatchObject({ title: B.task.title, version: 1, columnId: B.columns[0]!.id });
  });

  it("refuses to assign a task to a user from another tenant", async () => {
    await expect(
      updateTask(db, A.owner.id, { organizationId: A.org.id, taskId: A.task.id, expectedVersion: (await getTask(A.task.id))!.version, patch: { assigneeId: B.member.id } })
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("audit logs are written only into the actor's own tenant", async () => {
    const logs = await listAuditLogs(db, B.owner.id, B.org.id, { limit: 200 });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.actorId === null || [B.owner.id, B.admin.id, B.member.id, B.viewer.id].includes(l.actorId))).toBe(true);
  });
});

describe("project listing", () => {
  it("counts only each project's own tasks", async () => {
    const { listProjects } = await import("@/server/services/workspace");
    const { projects } = await listProjects(db, A.owner.id, A.org.slug);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.taskCount).toBeGreaterThanOrEqual(1);
  });
});
