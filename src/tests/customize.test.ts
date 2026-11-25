import { beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { boardColumns, tasks } from "@/db/schema";
import { createTask } from "@/server/services/tasks";
import {
  addStatus,
  createField,
  deleteSavedView,
  deleteStatus,
  listSavedViews,
  moveStatus,
  saveView,
  setCoAssignees,
  setFieldValue,
  setWatching,
  updateField,
  updateSavedView,
  updateStatus,
} from "@/server/services/customize";
import { getProjectMeta } from "@/server/services/breakdown";
import { makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;
const cols = () => db.select().from(boardColumns).where(eq(boardColumns.projectId, T.project.id)).orderBy(asc(boardColumns.position));

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Custom");
  Other = await makeTenant("Outside");
});

describe("custom statuses", () => {
  it("adds a status just before Done (admins only), unique names", async () => {
    await expect(addStatus(db, T.member.id, T.org.id, T.project.id, { title: "QA" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await addStatus(db, T.admin.id, T.org.id, T.project.id, { title: "QA", color: "#e44a8a" });
    const list = await cols();
    expect(list.map((c) => c.title)).toEqual(["Backlog", "In Progress", "Review", "QA", "Done"]);
    expect(list[3]!.color).toBe("#e44a8a");
    await expect(addStatus(db, T.admin.id, T.org.id, T.project.id, { title: "qa" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(addStatus(db, T.admin.id, T.org.id, T.project.id, { title: "X", color: "#123456" })).rejects.toThrow();
  });

  it("Done always stays last: can't move it, can't move past it", async () => {
    const list = await cols();
    const done = list[list.length - 1]!;
    const qa = list.find((c) => c.title === "QA")!;
    await expect(moveStatus(db, T.admin.id, T.org.id, done.id, "left")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(moveStatus(db, T.admin.id, T.org.id, qa.id, "right")).rejects.toMatchObject({ code: "VALIDATION" });
    await moveStatus(db, T.admin.id, T.org.id, qa.id, "left");
    expect((await cols()).map((c) => c.title)).toEqual(["Backlog", "In Progress", "QA", "Review", "Done"]);
  });

  it("renames and recolors, including Done", async () => {
    const list = await cols();
    await updateStatus(db, T.admin.id, T.org.id, list[list.length - 1]!.id, { title: "Shipped", color: "#0f9d74" });
    expect((await cols()).at(-1)).toMatchObject({ title: "Shipped", color: "#0f9d74" });
    await expect(updateStatus(db, T.admin.id, T.org.id, list[0]!.id, { title: "review" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("deleting a status moves its tasks; Done can't be deleted", async () => {
    const list = await cols();
    const qa = list.find((c) => c.title === "QA")!;
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: qa.id, title: "In QA" });
    await expect(deleteStatus(db, T.admin.id, T.org.id, list.at(-1)!.id, list[0]!.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(deleteStatus(db, T.admin.id, T.org.id, qa.id, qa.id)).rejects.toMatchObject({ code: "VALIDATION" });
    const res = await deleteStatus(db, T.admin.id, T.org.id, qa.id, list[0]!.id);
    expect(res.moved).toHaveLength(1);
    const [moved] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(moved).toMatchObject({ columnId: list[0]!.id, version: t.version + 1 });
  });

  it("can't touch another tenant's statuses", async () => {
    const [foreign] = await db.select().from(boardColumns).where(eq(boardColumns.projectId, Other.project.id)).limit(1);
    await expect(updateStatus(db, T.admin.id, T.org.id, foreign!.id, { title: "Hijack" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("custom fields", () => {
  it("creates typed fields (admins only) and validates values per type", async () => {
    await expect(createField(db, T.member.id, T.org.id, T.project.id, { name: "Effort", type: "number" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    const num = await createField(db, T.admin.id, T.org.id, T.project.id, { name: "Effort", type: "number" });
    const sel = await createField(db, T.admin.id, T.org.id, T.project.id, {
      name: "Team",
      type: "select",
      options: [{ label: "Web", color: "#3f7cb8" }, { label: "Mobile", color: "#e44a8a" }],
    });
    const person = await createField(db, T.admin.id, T.org.id, T.project.id, { name: "Reviewer", type: "person" });
    const date = await createField(db, T.admin.id, T.org.id, T.project.id, { name: "Launch", type: "date" });
    await expect(createField(db, T.admin.id, T.org.id, T.project.id, { name: "Empty", type: "select" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createField(db, T.admin.id, T.org.id, T.project.id, { name: "effort", type: "text" })).rejects.toMatchObject({ code: "CONFLICT" });

    const t = T.task.id;
    await setFieldValue(db, T.member.id, T.org.id, t, num.id, 5);
    await expect(setFieldValue(db, T.member.id, T.org.id, t, num.id, "five")).rejects.toThrow();
    await setFieldValue(db, T.member.id, T.org.id, t, sel.id, sel.options[1]!.id);
    await expect(setFieldValue(db, T.member.id, T.org.id, t, sel.id, "not-an-option")).rejects.toMatchObject({ code: "VALIDATION" });
    await setFieldValue(db, T.member.id, T.org.id, t, person.id, T.admin.id);
    await expect(setFieldValue(db, T.member.id, T.org.id, t, person.id, Other.owner.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setFieldValue(db, T.member.id, T.org.id, t, date.id, "2026-02-30")).rejects.toMatchObject({ code: "VALIDATION" });
    await setFieldValue(db, T.member.id, T.org.id, t, date.id, "2026-12-01");
    await expect(setFieldValue(db, T.viewer.id, T.org.id, t, num.id, 1)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });

    const meta = await getProjectMeta(db, T.viewer.id, T.org.id, T.project.id);
    expect(meta.fields.map((f) => f.name)).toEqual(["Effort", "Team", "Reviewer", "Launch"]);
    expect(meta.fieldValues[t]).toMatchObject({ [num.id]: 5, [sel.id]: sel.options[1]!.id, [person.id]: T.admin.id, [date.id]: "2026-12-01" });

    // Clearing with null removes the value.
    await setFieldValue(db, T.member.id, T.org.id, t, num.id, null);
    expect((await getProjectMeta(db, T.viewer.id, T.org.id, T.project.id)).fieldValues[t]?.[num.id]).toBeUndefined();

    // Removing a dropdown option clears values that used it.
    await updateField(db, T.admin.id, T.org.id, sel.id, { options: [{ id: sel.options[0]!.id, label: "Web", color: "#3f7cb8" }] });
    expect((await getProjectMeta(db, T.viewer.id, T.org.id, T.project.id)).fieldValues[t]?.[sel.id]).toBeUndefined();
  });

  it("values can't be set for another project's field or another tenant's task", async () => {
    const field = (await getProjectMeta(db, T.owner.id, T.org.id, T.project.id)).fields[0]!;
    await expect(setFieldValue(db, Other.member.id, Other.org.id, Other.task.id, field.id, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setFieldValue(db, T.member.id, T.org.id, Other.task.id, field.id, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("co-assignees and watchers", () => {
  it("sets co-assignees (members only, same workspace), excluding the primary", async () => {
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Pair", assigneeId: T.member.id });
    const r = await setCoAssignees(db, T.member.id, T.org.id, t.id, [T.member.id, T.admin.id, T.admin.id]);
    expect(r.coAssignees).toEqual([T.admin.id]);
    await expect(setCoAssignees(db, T.member.id, T.org.id, t.id, [Other.owner.id])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(setCoAssignees(db, T.viewer.id, T.org.id, t.id, [])).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    const meta = await getProjectMeta(db, T.viewer.id, T.org.id, T.project.id);
    expect(meta.coAssignees[t.id]).toEqual([T.admin.id]);
  });

  it("anyone in the workspace, including viewers, can watch", async () => {
    await setWatching(db, T.viewer.id, T.org.id, T.task.id, true);
    await setWatching(db, T.viewer.id, T.org.id, T.task.id, true); // idempotent
    expect((await getProjectMeta(db, T.viewer.id, T.org.id, T.project.id)).watchers[T.task.id]).toEqual([T.viewer.id]);
    await setWatching(db, T.viewer.id, T.org.id, T.task.id, false);
    expect((await getProjectMeta(db, T.viewer.id, T.org.id, T.project.id)).watchers[T.task.id]).toBeUndefined();
    await expect(setWatching(db, Other.owner.id, T.org.id, T.task.id, true)).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });
});

describe("saved views", () => {
  const config = { view: "table", filters: { q: "bug" }, sort: { key: "dueDate", dir: "asc" as const }, groupBy: "assignee" };

  it("personal by default; shared views are visible to the project", async () => {
    const mine = await saveView(db, T.member.id, T.org.id, T.project.id, { name: "My bugs", config });
    const shared = await saveView(db, T.member.id, T.org.id, T.project.id, { name: "Team bugs", config, shared: true });
    expect((await listSavedViews(db, T.member.id, T.org.id, T.project.id)).map((v) => v.name)).toEqual(["My bugs", "Team bugs"]);
    expect((await listSavedViews(db, T.admin.id, T.org.id, T.project.id)).map((v) => v.name)).toEqual(["Team bugs"]);

    // Viewers may save personal views but not share them.
    await saveView(db, T.viewer.id, T.org.id, T.project.id, { name: "Peek", config });
    await expect(saveView(db, T.viewer.id, T.org.id, T.project.id, { name: "Broadcast", config, shared: true })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });

    // Others can't see or edit a personal view; admins can manage shared ones.
    await expect(updateSavedView(db, T.admin.id, T.org.id, mine.id, { name: "Hijacked" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateSavedView(db, T.viewer.id, T.org.id, shared.id, { name: "Nope" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateSavedView(db, T.admin.id, T.org.id, shared.id, { name: "Team bugs (cleaned)" });
    await deleteSavedView(db, T.member.id, T.org.id, mine.id);
    expect((await listSavedViews(db, T.member.id, T.org.id, T.project.id)).map((v) => v.name)).toEqual(["Team bugs (cleaned)"]);
  });

  it("rejects unknown view types", async () => {
    await expect(saveView(db, T.member.id, T.org.id, T.project.id, { name: "Bad", config: { ...config, view: "hologram" } })).rejects.toThrow();
  });
});
