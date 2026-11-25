import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLogs, boardColumns, taskDependencies } from "@/db/schema";
import { createTask } from "@/server/services/tasks";
import {
  addChecklistItem,
  addDependency,
  createTag,
  deleteChecklistItem,
  getProjectMeta,
  listChecklist,
  reaches,
  removeDependency,
  setChecklistItemDone,
  setTaskTag,
} from "@/server/services/breakdown";
import { createProject } from "@/server/services/workspace";
import { makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;

const newTask = (title: string, extra: Record<string, unknown> = {}) =>
  createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title, ...extra });

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Wbs");
  Other = await makeTenant("Xeno");
});

describe("subtasks", () => {
  it("links a subtask to its parent", async () => {
    const parent = await newTask("Parent");
    const child = await newTask("Child", { parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });

  it("stays one level deep", async () => {
    const parent = await newTask("P");
    const child = await newTask("C", { parentId: parent.id });
    await expect(newTask("Grandchild", { parentId: child.id })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a parent from another tenant or another project", async () => {
    // Another tenant's task id looks exactly like a missing one.
    await expect(newTask("Smuggled", { parentId: Other.task.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Same tenant, different project: an ENG parent can't own a task placed on the OPS board.
    const ops = await createProject(db, T.owner.id, { organizationId: T.org.id, name: "Ops", key: "OPS" });
    const [opsCol] = await db.select().from(boardColumns).where(eq(boardColumns.projectId, ops.id)).limit(1);
    const engParent = await newTask("ENG parent");
    await expect(
      createTask(db, T.member.id, { organizationId: T.org.id, columnId: opsCol!.id, title: "Cross", parentId: engParent.id })
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("deleting a parent deletes its subtasks (cascade)", async () => {
    const { deleteTask } = await import("@/server/services/tasks");
    const { tasks } = await import("@/db/schema");
    const parent = await newTask("Doomed");
    const child = await newTask("Doomed child", { parentId: parent.id });
    await deleteTask(db, T.member.id, T.org.id, parent.id);
    expect(await db.select().from(tasks).where(eq(tasks.id, child.id))).toHaveLength(0);
  });
});

describe("checklists", () => {
  it("adds, toggles and deletes items with audit rows, and rolls up into project meta", async () => {
    const t = await newTask("With checklist");
    const a = await addChecklistItem(db, T.member.id, T.org.id, t.id, "Write spec");
    const b = await addChecklistItem(db, T.member.id, T.org.id, t.id, "Ship it");
    expect(b.item.position).toBeGreaterThan(a.item.position);
    await setChecklistItemDone(db, T.member.id, T.org.id, a.item.id, true);

    const meta = await getProjectMeta(db, T.viewer.id, T.org.id, T.project.id);
    expect(meta.checklist[t.id]).toEqual({ done: 1, total: 2 });

    await deleteChecklistItem(db, T.member.id, T.org.id, b.item.id);
    expect(await listChecklist(db, T.viewer.id, T.org.id, t.id)).toHaveLength(1);

    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, t.id)));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["CHECKLIST_ITEM_ADDED", "CHECKLIST_ITEM_DONE", "CHECKLIST_ITEM_DELETED"]));
  });

  it("viewers can read but not write", async () => {
    await expect(addChecklistItem(db, T.viewer.id, T.org.id, T.task.id, "nope")).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
  });

  it("is tenant-isolated (items and tasks of other orgs look missing)", async () => {
    const t = await newTask("Mine");
    const { item } = await addChecklistItem(db, T.member.id, T.org.id, t.id, "secret");
    await expect(setChecklistItemDone(db, Other.owner.id, Other.org.id, item.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addChecklistItem(db, Other.owner.id, Other.org.id, t.id, "x")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listChecklist(db, Other.owner.id, T.org.id, t.id)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });
});

describe("tags", () => {
  it("creates org tags (case-insensitive unique) and attaches them idempotently", async () => {
    const tag = await createTag(db, T.member.id, T.org.id, { name: "Backend", color: "#3f7cb8" });
    await expect(createTag(db, T.member.id, T.org.id, { name: "backend", color: "#7b68ee" })).rejects.toMatchObject({ code: "CONFLICT" });
    const t = await newTask("Tagged");
    expect(await setTaskTag(db, T.member.id, T.org.id, t.id, tag.id, true)).toMatchObject({ changed: true });
    expect(await setTaskTag(db, T.member.id, T.org.id, t.id, tag.id, true)).toMatchObject({ changed: false });
    const meta = await getProjectMeta(db, T.viewer.id, T.org.id, T.project.id);
    expect(meta.tagsByTask[t.id]).toEqual([tag.id]);
    expect(meta.tags.map((x) => x.name)).toContain("Backend");
    expect(await setTaskTag(db, T.member.id, T.org.id, t.id, tag.id, false)).toMatchObject({ changed: true });
  });

  it("rejects colors outside the palette and another tenant's tag", async () => {
    await expect(createTag(db, T.member.id, T.org.id, { name: "Evil", color: "#000000" as never })).rejects.toThrow();
    const foreign = await createTag(db, Other.owner.id, Other.org.id, { name: "Theirs", color: "#0f9d74" });
    await expect(setTaskTag(db, T.member.id, T.org.id, T.task.id, foreign.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("tags are per tenant: same name is fine in another org", async () => {
    await expect(createTag(db, Other.owner.id, Other.org.id, { name: "Backend", color: "#3f7cb8" })).resolves.toMatchObject({ name: "Backend" });
  });
});

describe("dependencies", () => {
  it("cycle detection helper", () => {
    const e = [
      { blockerId: "a", blockedId: "b" },
      { blockerId: "b", blockedId: "c" },
    ];
    expect(reaches(e, "a", "c")).toBe(true);
    expect(reaches(e, "c", "a")).toBe(false);
  });

  it("adds A blocks B, rejects self, cycles and duplicates are harmless", async () => {
    const a = await newTask("A");
    const b = await newTask("B");
    const c = await newTask("C");
    await addDependency(db, T.member.id, T.org.id, a.id, b.id);
    await addDependency(db, T.member.id, T.org.id, b.id, c.id);
    await addDependency(db, T.member.id, T.org.id, a.id, b.id); // duplicate: no-op

    await expect(addDependency(db, T.member.id, T.org.id, a.id, a.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(addDependency(db, T.member.id, T.org.id, c.id, a.id)).rejects.toMatchObject({ code: "CONFLICT" }); // c→a closes a→b→c→a

    const meta = await getProjectMeta(db, T.viewer.id, T.org.id, T.project.id);
    expect(meta.deps).toEqual(expect.arrayContaining([{ blockerId: a.id, blockedId: b.id }, { blockerId: b.id, blockedId: c.id }]));

    await removeDependency(db, T.member.id, T.org.id, a.id, b.id);
    expect(await db.select().from(taskDependencies).where(eq(taskDependencies.blockerId, a.id))).toHaveLength(0);
  });

  it("refuses cross-tenant links and viewer writes", async () => {
    const mine = await newTask("Mine");
    await expect(addDependency(db, T.member.id, T.org.id, mine.id, Other.task.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addDependency(db, T.viewer.id, T.org.id, mine.id, T.task.id)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
  });

  it("the database itself rejects a self-dependency", async () => {
    await expect(
      db.insert(taskDependencies).values({ organizationId: T.org.id, blockerId: T.task.id, blockedId: T.task.id })
    ).rejects.toThrow();
  });
});

describe("demo seed", () => {
  it("creates a workspace with tags, a checklist, subtasks and dependencies", async () => {
    const { seedDemoWorkspace } = await import("@/server/services/demo");
    const { listProjects } = await import("@/server/services/workspace");
    const { tasks: tasksTable } = await import("@/db/schema");
    const org = await seedDemoWorkspace(db, T.owner.id);
    const { projects } = await listProjects(db, T.owner.id, org.slug);
    const eng = projects.find((p) => p.key === "ENG")!;
    const meta = await getProjectMeta(db, T.owner.id, org.id, eng.id);
    expect(meta.tags.map((t) => t.name).sort()).toEqual(["Backend", "Customer", "Frontend", "Security"]);
    expect(Object.values(meta.checklist)).toContainEqual({ done: 1, total: 4 });
    expect(meta.deps).toHaveLength(2);
    const subs = await db.select().from(tasksTable).where(and(eq(tasksTable.projectId, eng.id)));
    expect(subs.filter((t) => t.parentId)).toHaveLength(2);
    // Task numbers stay unique and sequential after the extra subtasks.
    expect(new Set(subs.map((t) => t.taskNumber)).size).toBe(subs.length);
  });
});
