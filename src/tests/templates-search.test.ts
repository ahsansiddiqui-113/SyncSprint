import { beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { boardColumns, checklistItems, customFields, organizations, projects, tags, taskTags, tasks } from "@/db/schema";
import * as tpl from "@/server/services/templates";
import { dismissOnboarding, getOnboarding, searchWorkspace } from "@/server/services/onboarding";
import { createTask } from "@/server/services/tasks";
import { addChecklistItem, createTag, setTaskTag } from "@/server/services/breakdown";
import { makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;
let Other: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Tpl");
  Other = await makeTenant("Rival");
});

describe("project templates", () => {
  it("lists built-ins and creates a project with statuses, WIP limits, fields, tags, tasks, subtasks and checklists", async () => {
    const list = await tpl.listProjectTemplates(db, T.member.id, T.org.id);
    expect(list.map((t) => t.id)).toContain("builtin:scrum");
    const p = await tpl.createProjectFromTemplate(db, T.owner.id, { organizationId: T.org.id, name: "Mobile", key: "MOB", templateId: "builtin:scrum" });
    const cols = await db.select().from(boardColumns).where(eq(boardColumns.projectId, p.id)).orderBy(asc(boardColumns.position));
    expect(cols.map((c) => c.title)).toEqual(["Backlog", "To Do", "In Progress", "Code Review", "Testing", "Done"]);
    expect(cols.find((c) => c.title === "In Progress")?.wipLimit).toBe(5);
    expect((await db.select().from(customFields).where(eq(customFields.projectId, p.id))).map((f) => f.name)).toEqual(expect.arrayContaining(["Component", "Release"]));
    const all = await db.select().from(tasks).where(eq(tasks.projectId, p.id));
    const signIn = all.find((t) => t.title === "User sign-in")!;
    expect(all.filter((t) => t.parentId === signIn.id).map((t) => t.title)).toEqual(expect.arrayContaining(["Sign-in form", "Password reset", "Session handling"]));
    const repo = all.find((t) => t.title.startsWith("Set up the repository"))!;
    expect(await db.select().from(checklistItems).where(eq(checklistItems.taskId, repo.id))).toHaveLength(3);
    const crash = all.find((t) => t.type === "bug")!;
    const crashTags = await db.select({ name: tags.name }).from(taskTags).innerJoin(tags, eq(tags.id, taskTags.tagId)).where(eq(taskTags.taskId, crash.id));
    expect(crashTags.map((t) => t.name)).toEqual(["customer"]);
  });

  it("refuses for non-admins, unknown templates, and cleans up on failure", async () => {
    await expect(tpl.createProjectFromTemplate(db, T.member.id, { organizationId: T.org.id, name: "Nope", key: "NOP", templateId: "builtin:scrum" })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await expect(tpl.createProjectFromTemplate(db, T.owner.id, { organizationId: T.org.id, name: "Ghost", key: "GHO", templateId: "builtin:nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(projects).where(and(eq(projects.organizationId, T.org.id), eq(projects.key, "GHO")))).toHaveLength(0);
  });

  it("saves a project as a template (round trip) — and other workspaces can't use it", async () => {
    const tag = await createTag(db, T.member.id, T.org.id, { name: "urgent-fix", color: "#7b68ee" });
    const parent = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[1]!.id, title: "Release 1.0", type: "epic" });
    await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[1]!.id, title: "Write notes", parentId: parent.id });
    await addChecklistItem(db, T.member.id, T.org.id, parent.id, "Tag the build");
    await setTaskTag(db, T.member.id, T.org.id, parent.id, tag.id, true);
    await expect(tpl.saveProjectAsTemplate(db, T.member.id, T.org.id, T.project.id, { name: "X", includeTasks: true })).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    const saved = await tpl.saveProjectAsTemplate(db, T.owner.id, T.org.id, T.project.id, { name: "Our process", includeTasks: true });
    const p2 = await tpl.createProjectFromTemplate(db, T.owner.id, { organizationId: T.org.id, name: "Copy", key: "CPY", templateId: saved.id });
    const copied = await db.select().from(tasks).where(eq(tasks.projectId, p2.id));
    const release = copied.find((t) => t.title === "Release 1.0")!;
    expect(release.type).toBe("epic");
    expect(copied.some((t) => t.parentId === release.id && t.title === "Write notes")).toBe(true);
    expect((await db.select().from(checklistItems).where(eq(checklistItems.taskId, release.id))).map((c) => c.text)).toEqual(["Tag the build"]);
    await expect(tpl.createProjectFromTemplate(db, Other.owner.id, { organizationId: Other.org.id, name: "Steal", key: "STL", templateId: saved.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await tpl.listProjectTemplates(db, Other.owner.id, Other.org.id)).some((t) => t.id === saved.id)).toBe(false);
  });
});

describe("task templates", () => {
  it("saves a task's checklist, tags and subtasks and recreates them", async () => {
    const tag = await createTag(db, T.member.id, T.org.id, { name: "bug-report", color: "#e44a8a" });
    const src = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Bug: ", type: "bug", priority: "high", description: "Steps to reproduce:\n1." });
    await addChecklistItem(db, T.member.id, T.org.id, src.id, "Reproduce");
    await addChecklistItem(db, T.member.id, T.org.id, src.id, "Write a test");
    await setTaskTag(db, T.member.id, T.org.id, src.id, tag.id, true);
    await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Root cause", parentId: src.id });
    await expect(tpl.saveTaskTemplate(db, T.viewer.id, T.org.id, src.id, "Bug report")).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    const { id } = await tpl.saveTaskTemplate(db, T.member.id, T.org.id, src.id, "Bug report");
    const made = await tpl.createTaskFromTemplate(db, T.admin.id, T.org.id, id, T.columns[2]!.id);
    expect(made.task).toMatchObject({ title: "Bug:", type: "bug", priority: "high", columnId: T.columns[2]!.id, description: "Steps to reproduce:\n1." });
    expect((await db.select().from(checklistItems).where(eq(checklistItems.taskId, made.task.id))).map((c) => c.text)).toEqual(["Reproduce", "Write a test"]);
    expect((await db.select().from(taskTags).where(eq(taskTags.taskId, made.task.id))).map((t) => t.tagId)).toEqual([tag.id]);
    expect(made.created.slice(1).map((t) => t.title)).toEqual(["Root cause"]);
    // Only its creator or an admin can delete it; other tenants can't use it.
    await expect(tpl.deleteTaskTemplate(db, T.viewer.id, T.org.id, id)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_MEMBER" });
    await expect(tpl.createTaskFromTemplate(db, Other.member.id, Other.org.id, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await tpl.deleteTaskTemplate(db, T.owner.id, T.org.id, id);
    expect(await tpl.listTaskTemplates(db, T.member.id, T.org.id, T.project.id)).toHaveLength(0);
  });
});

describe("onboarding and search", () => {
  it("works out the checklist from data; admins can hide it", async () => {
    const o = await getOnboarding(db, T.owner.id, T.org.id, T.org.slug);
    expect(o!.steps.find((s) => s.id === "project")!.done).toBe(true);
    expect(o!.steps.find((s) => s.id === "invite")!.done).toBe(true);
    expect(o!.steps.find((s) => s.id === "automate")!.done).toBe(false);
    await expect(dismissOnboarding(db, T.member.id, T.org.id)).rejects.toMatchObject({ code: "FORBIDDEN_REQUIRES_ADMIN" });
    await dismissOnboarding(db, T.owner.id, T.org.id);
    expect(await getOnboarding(db, T.owner.id, T.org.id, T.org.slug)).toBeNull();
    await db.update(organizations).set({ onboardingDismissedAt: null }).where(eq(organizations.id, T.org.id));
  });

  it("finds tasks by ref and title, projects, people — never another tenant's, and treats % _ literally", async () => {
    const t = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: T.columns[0]!.id, title: "Invoice 100% discount glitch" });
    await createTask(db, Other.member.id, { organizationId: Other.org.id, columnId: Other.columns[0]!.id, title: "Invoice from the rival" });
    const byRef = await searchWorkspace(db, T.viewer.id, T.org.id, `eng-${t.taskNumber}`);
    expect(byRef.tasks[0]).toMatchObject({ id: t.id, ref: `ENG-${t.taskNumber}` });
    const byTitle = await searchWorkspace(db, T.viewer.id, T.org.id, "invoice");
    expect(byTitle.tasks.map((x) => x.title)).toEqual(["Invoice 100% discount glitch"]);
    expect((await searchWorkspace(db, T.viewer.id, T.org.id, "100%")).tasks).toHaveLength(1);
    expect((await searchWorkspace(db, T.viewer.id, T.org.id, "%")).tasks.every((x) => x.title.includes("%"))).toBe(true);
    expect((await searchWorkspace(db, T.viewer.id, T.org.id, "Tpl Project")).projects).toHaveLength(1);
    expect((await searchWorkspace(db, T.viewer.id, T.org.id, "Tpl Member")).people.length).toBeGreaterThan(0);
    await expect(searchWorkspace(db, Other.member.id, T.org.id, "invoice")).rejects.toMatchObject({ code: "FORBIDDEN_NOT_A_MEMBER" });
  });
});
