import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { auditLogs, boardColumns, projects, tasks } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Flow analytics (Azure Boards Analytics / Kanban metrics), from the audit trail of
 * creations and moves:
 *  - cumulative flow diagram: tasks in each status at the end of every day
 *  - lead time: created → finished;  cycle time: started (left the first status) → finished
 *  - throughput: tasks finished per week
 * "Finished" is the last time a task entered the last status, if it's still there.
 */

const DAY = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export type FlowEvent = { taskId: string; at: Date; from: string | null; to: string };
export type FlowTask = { id: string; ref: string; title: string; createdAt: Date; columnId: string };

function stats(values: number[]) {
  if (!values.length) return { count: 0, avg: null, p50: null, p85: null };
  const v = [...values].sort((a, b) => a - b);
  const pct = (p: number) => v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)]!;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { count: v.length, avg: r(v.reduce((s, x) => s + x, 0) / v.length), p50: r(pct(50)), p85: r(pct(85)) };
}

/** Pure: everything is computed here so it can be tested without a database. */
export function computeFlow(columnIds: string[], list: FlowTask[], events: FlowEvent[], days: number, now: Date) {
  const first = columnIds[0]!;
  const done = columnIds[columnIds.length - 1]!;
  const byTask = new Map<string, FlowEvent[]>();
  for (const e of [...events].sort((a, b) => +a.at - +b.at)) byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e]);

  // Each task's status timeline: [{at, column}] starting at creation.
  const timelines = new Map<string, { at: Date; col: string }[]>();
  for (const t of list) {
    const ev = byTask.get(t.id) ?? [];
    const created = ev.find((e) => e.from === null);
    const firstMove = ev.find((e) => e.from !== null);
    const startCol = created?.to ?? firstMove?.from ?? t.columnId;
    const tl = [{ at: created?.at ?? t.createdAt, col: startCol }];
    for (const e of ev) if (e.from !== null) tl.push({ at: e.at, col: e.to });
    timelines.set(t.id, tl);
  }

  // Cumulative flow: status at the end of each day.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - (days - 1) * DAY);
  const cfd = Array.from({ length: days }, (_, i) => {
    const day = new Date(start.getTime() + i * DAY);
    const cutoff = new Date(day.getTime() + DAY - 1);
    const counts: Record<string, number> = Object.fromEntries(columnIds.map((c) => [c, 0]));
    for (const tl of timelines.values()) {
      if (tl[0]!.at > cutoff) continue;
      let col = tl[0]!.col;
      for (const step of tl) if (step.at <= cutoff) col = step.col;
      if (col in counts) counts[col]!++;
    }
    return { day: dayOf(day), counts };
  });

  // Lead / cycle time for tasks currently finished.
  const finished: { id: string; ref: string; title: string; doneAt: string; leadDays: number; cycleDays: number | null }[] = [];
  for (const t of list) {
    if (t.columnId !== done) continue;
    const tl = timelines.get(t.id)!;
    const doneAt = [...tl].reverse().find((s) => s.col === done)?.at;
    if (!doneAt) continue;
    const started = tl.find((s) => s.col !== first)?.at ?? null;
    finished.push({
      id: t.id, ref: t.ref, title: t.title, doneAt: doneAt.toISOString(),
      leadDays: Math.max(0, (+doneAt - +tl[0]!.at) / DAY),
      cycleDays: started ? Math.max(0, (+doneAt - +started) / DAY) : null,
    });
  }
  const recent = finished.filter((f) => +new Date(f.doneAt) >= +start);

  // Throughput by ISO week (Monday start), across the window.
  const weekStart = (d: Date) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    return dayOf(x);
  };
  const weeks = new Map<string, number>();
  for (let t = +start; t <= +end; t += 7 * DAY) weeks.set(weekStart(new Date(t)), 0);
  weeks.set(weekStart(end), weeks.get(weekStart(end)) ?? 0);
  for (const f of recent) {
    const w = weekStart(new Date(f.doneAt));
    if (weeks.has(w)) weeks.set(w, weeks.get(w)! + 1);
  }

  const wip = list.filter((t) => t.columnId !== first && t.columnId !== done).length;
  return {
    cfd,
    lead: stats(recent.map((f) => f.leadDays)),
    cycle: stats(recent.flatMap((f) => (f.cycleDays === null ? [] : [f.cycleDays]))),
    throughput: [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([week, count]) => ({ week, count })),
    finished: recent.sort((a, b) => (a.doneAt < b.doneAt ? -1 : 1)),
    wip,
  };
}

export async function flowMetrics(conn: DB, actorId: string, organizationId: string, projectId: string, rawDays = 30, now = new Date()) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const days = Math.min(Math.max(Math.trunc(rawDays) || 30, 7), 180);
  const [p] = await conn.select({ key: projects.key }).from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
  const cols = await conn.select({ id: boardColumns.id, title: boardColumns.title }).from(boardColumns).where(eq(boardColumns.projectId, projectId)).orderBy(asc(boardColumns.position));
  const rows = await conn.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, createdAt: tasks.createdAt, columnId: tasks.columnId }).from(tasks).where(and(eq(tasks.organizationId, organizationId), eq(tasks.projectId, projectId)));
  const ids = rows.map((r) => r.id);
  const logs = ids.length
    ? await conn
        .select({ entityId: auditLogs.entityId, action: auditLogs.action, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
        .from(auditLogs)
        .where(and(eq(auditLogs.organizationId, organizationId), inArray(auditLogs.action, ["TASK_CREATED", "TASK_MOVED"]), inArray(auditLogs.entityId, ids)))
        .orderBy(asc(auditLogs.createdAt))
        .limit(50_000)
    : [];
  const events: FlowEvent[] = logs.flatMap((l): FlowEvent[] => {
    const m = l.metadata as { columnId?: string; fromColumnId?: string; targetColumnId?: string };
    if (l.action === "TASK_CREATED" && m.columnId) return [{ taskId: l.entityId, at: l.createdAt, from: null, to: m.columnId }];
    if (l.action === "TASK_MOVED" && m.fromColumnId && m.targetColumnId && m.fromColumnId !== m.targetColumnId) return [{ taskId: l.entityId, at: l.createdAt, from: m.fromColumnId, to: m.targetColumnId }];
    return [];
  });
  const flow = computeFlow(cols.map((c) => c.id), rows.map((r) => ({ id: r.id, ref: `${p.key}-${r.number}`, title: r.title, createdAt: r.createdAt, columnId: r.columnId })), events, days, now);
  return { columns: cols, days, ...flow };
}
