import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { auditLogs, tasks } from "@/db/schema";
import { createTask, moveTask, updateTask } from "@/server/services/tasks";
import { changeFacts, describeFacts } from "@/server/ai/features";
import { MIN_GAP } from "@/lib/fractional-index";
import { getTask, makeTenant, testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
let T: Awaited<ReturnType<typeof makeTenant>>;

const auditFor = (taskId: string) =>
  db.select().from(auditLogs).where(and(eq(auditLogs.entityId, taskId), eq(auditLogs.action, "TASK_MOVED")));

beforeAll(async () => {
  db = await testDb();
  T = await makeTenant("Occ");
});

describe("optimistic concurrency control", () => {
  it("increments version and writes exactly one audit row on success", async () => {
    const res = await moveTask(db, T.member.id, {
      organizationId: T.org.id,
      taskId: T.task.id,
      targetColumnId: T.columns[1]!.id,
      newPosition: 1024,
      expectedVersion: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.task.version).toBe(2);
    expect(res.task.columnId).toBe(T.columns[1]!.id);
    const logs = await auditFor(T.task.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({ version: 2, targetColumnId: T.columns[1]!.id });
  });

  it("rejects a stale expectedVersion with VERSION_CONFLICT and returns the current row", async () => {
    const res = await moveTask(db, T.admin.id, {
      organizationId: T.org.id,
      taskId: T.task.id,
      targetColumnId: T.columns[2]!.id,
      newPosition: 2048,
      expectedVersion: 1, // stale: server is at v2
    });
    expect(res).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });
    if (res.ok) return;
    expect(res.current).toMatchObject({ version: 2, columnId: T.columns[1]!.id });

    // Nothing leaked: row unchanged and no audit row for the rejected write.
    expect(await getTask(T.task.id)).toMatchObject({ version: 2, columnId: T.columns[1]!.id });
    expect(await auditFor(T.task.id)).toHaveLength(1);
  });

  it("lets exactly one of two simultaneous writers win", async () => {
    const t = await getTask(T.task.id);
    const attempt = (columnIdx: number, actor: string) =>
      moveTask(db, actor, {
        organizationId: T.org.id,
        taskId: T.task.id,
        targetColumnId: T.columns[columnIdx]!.id,
        newPosition: 4096,
        expectedVersion: t!.version,
      });
    const results = await Promise.all([attempt(2, T.member.id), attempt(3, T.admin.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "VERSION_CONFLICT")).toHaveLength(1);
    expect((await getTask(T.task.id))!.version).toBe(t!.version + 1);
  });

  it("applies the same rule to field edits and records before/after values", async () => {
    const t = (await getTask(T.task.id))!;
    const ok = await updateTask(db, T.member.id, { organizationId: T.org.id, taskId: t.id, expectedVersion: t.version, patch: { priority: "urgent", title: "Renamed" } });
    expect(ok).toMatchObject({ ok: true, changes: expect.arrayContaining(["priority", "title"]) });
    const stale = await updateTask(db, T.admin.id, { organizationId: T.org.id, taskId: t.id, expectedVersion: t.version, patch: { priority: "low" } });
    expect(stale).toMatchObject({ ok: false, code: "VERSION_CONFLICT" });

    const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, t.id), eq(auditLogs.action, "TASK_UPDATED")));
    expect(log!.metadata).toMatchObject({ changes: { priority: { from: "medium", to: "urgent" } } });
  });

  it("explains what changed since the client's version, using only audit facts", async () => {
    const { facts } = await changeFacts(db, T.org.id, T.task.id, 1);
    expect(facts.length).toBeGreaterThanOrEqual(3);
    const sentence = describeFacts(facts);
    expect(sentence).toMatch(/moved ENG-1 to/);
    expect(sentence).toMatch(/changed priority of ENG-1 from "medium" to "urgent"/);
  });
});

describe("fractional indexing on the server", () => {
  it("moving a card updates only that card's row", async () => {
    const col = T.columns[0]!.id;
    const a = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: col, title: "A" });
    const b = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: col, title: "B" });
    const before = await db.select().from(tasks).where(eq(tasks.columnId, col));

    const res = await moveTask(db, T.member.id, { organizationId: T.org.id, taskId: b.id, targetColumnId: col, newPosition: a.position / 2, expectedVersion: b.version });
    expect(res.ok).toBe(true);
    const after = await db.select().from(tasks).where(eq(tasks.columnId, col));
    const changed = after.filter((r) => before.find((x) => x.id === r.id)!.position !== r.position);
    expect(changed.map((r) => r.id)).toEqual([b.id]);
  });

  it("rebalances the column when the gap falls below MIN_GAP", async () => {
    const col = T.columns[3]!.id;
    const x = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: col, title: "X" });
    const y = await createTask(db, T.member.id, { organizationId: T.org.id, columnId: col, title: "Y" });
    const res = await moveTask(db, T.member.id, {
      organizationId: T.org.id,
      taskId: y.id,
      targetColumnId: col,
      newPosition: x.position + MIN_GAP / 10, // squeezed right next to X
      expectedVersion: y.version,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rebalanced).not.toBeNull();
    const rows = (await db.select().from(tasks).where(eq(tasks.columnId, col))).sort((p, q) => p.position - q.position);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.position - rows[i - 1]!.position).toBeGreaterThanOrEqual(1024);
    // Order preserved: X before Y.
    expect(rows.findIndex((r) => r.id === x.id)).toBeLessThan(rows.findIndex((r) => r.id === y.id));
  });

  it("mints sequential task numbers per project", async () => {
    const col = T.columns[0]!.id;
    const created = await Promise.all([1, 2, 3].map((i) => createTask(db, T.member.id, { organizationId: T.org.id, columnId: col, title: `N${i}` })));
    const numbers = created.map((c) => c.taskNumber).sort((p, q) => p - q);
    expect(new Set(numbers).size).toBe(3);
    expect(numbers[2]! - numbers[0]!).toBe(2);
  });
});
