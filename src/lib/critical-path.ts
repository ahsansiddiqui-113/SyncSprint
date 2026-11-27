/**
 * Critical path (CPM) over open tasks and their "blocked by" links, in working days.
 *
 *  - duration: working days from start to due (inclusive); a task with only an estimate
 *    takes ceil(hours / 8) days; otherwise 1 day
 *  - a task can't start before its own start date or before all its open blockers finish
 *  - forward pass → earliest start/finish; backward pass from the latest finish →
 *    latest start; slack = latest start − earliest start
 *  - critical = zero slack: any delay there moves the end of the project
 * Finished tasks impose no constraint. Cycles (prevented on write) are ignored defensively.
 */

export type CpmTask = { id: string; startDate: string | null; dueDate: string | null; estimateHours: number | null; done: boolean };
export type CpmResult = {
  critical: Set<string>;
  slack: Map<string, number>;
  /** Earliest start / finish as working-day offsets from `base`. */
  earliest: Map<string, { start: number; finish: number }>;
  /** Length of the project from `base` in working days. */
  length: number;
  /** The critical tasks in schedule order. */
  chain: string[];
  base: string;
};

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isWeekend = (ms: number) => {
  const d = new Date(ms).getUTCDay();
  return d === 0 || d === 6;
};

/** Working days from a to b inclusive (at least 1, so a weekend-only task still counts). */
export function workingDays(a: string, b: string): number {
  let n = 0;
  for (let t = utc(a); t <= utc(b); t += DAY) if (!isWeekend(t)) n++;
  return Math.max(1, n);
}

/** Working days from base up to (not including) iso; negative if before base. */
export function workingOffset(base: string, iso: string): number {
  if (iso === base) return 0;
  const [from, to, sign] = utc(iso) > utc(base) ? [utc(base), utc(iso), 1] : [utc(iso), utc(base), -1];
  let n = 0;
  for (let t = from; t < to; t += DAY) if (!isWeekend(t)) n++;
  return n * sign;
}

/** The date `n` working days after base (n = 0 → base itself, moved off a weekend). */
export function addWorkingDays(base: string, n: number): string {
  let t = utc(base);
  while (isWeekend(t)) t += DAY;
  for (let left = n; left > 0; ) {
    t += DAY;
    if (!isWeekend(t)) left--;
  }
  return new Date(t).toISOString().slice(0, 10);
}

export function durationOf(t: CpmTask): number {
  const s = t.startDate ?? t.dueDate;
  const e = t.dueDate ?? t.startDate;
  if (s && e) return workingDays(s, e);
  if (t.estimateHours && t.estimateHours > 0) return Math.ceil(t.estimateHours / 8);
  return 1;
}

export function criticalPath(tasks: CpmTask[], deps: { blockerId: string; blockedId: string }[], today: string): CpmResult {
  const open = tasks.filter((t) => !t.done);
  const byId = new Map(open.map((t) => [t.id, t]));
  const edges = deps.filter((d) => byId.has(d.blockerId) && byId.has(d.blockedId) && d.blockerId !== d.blockedId);
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of edges) {
    preds.set(e.blockedId, [...(preds.get(e.blockedId) ?? []), e.blockerId]);
    succs.set(e.blockerId, [...(succs.get(e.blockerId) ?? []), e.blockedId]);
  }

  // Base = the earliest scheduled date among open work, but never before today (the past is fixed).
  const starts = open.map((t) => t.startDate ?? t.dueDate).filter((d): d is string => !!d).sort();
  const base = starts[0] && starts[0] > today ? starts[0] : today;

  // Kahn's algorithm for a topological order; anything left over is in a cycle and skipped.
  const indeg = new Map(open.map((t) => [t.id, (preds.get(t.id) ?? []).length]));
  const queue = open.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succs.get(id) ?? []) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }

  const dur = new Map(order.map((id) => [id, durationOf(byId.get(id)!)]));
  const earliest = new Map<string, { start: number; finish: number }>();
  for (const id of order) {
    const t = byId.get(id)!;
    // Its own date: the start date, or (one-day task with only a due date) that day.
    const own = t.startDate ?? t.dueDate;
    const fromDate = own ? Math.max(0, workingOffset(base, own)) : 0;
    const fromPreds = Math.max(0, ...(preds.get(id) ?? []).map((p) => earliest.get(p)?.finish ?? 0));
    const start = Math.max(fromDate, fromPreds);
    earliest.set(id, { start, finish: start + dur.get(id)! });
  }
  const length = Math.max(0, ...[...earliest.values()].map((e) => e.finish));

  const latestFinish = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const next = (succs.get(id) ?? []).filter((s) => latestFinish.has(s));
    const lf = next.length ? Math.min(...next.map((s) => latestFinish.get(s)! - dur.get(s)!)) : length;
    latestFinish.set(id, lf);
  }

  const slack = new Map<string, number>();
  const critical = new Set<string>();
  for (const id of order) {
    const s = latestFinish.get(id)! - dur.get(id)! - earliest.get(id)!.start;
    slack.set(id, s);
    if (s <= 0) critical.add(id);
  }
  const chain = order.filter((id) => critical.has(id)).sort((a, b) => earliest.get(a)!.start - earliest.get(b)!.start);
  return { critical, slack, earliest, length, chain, base };
}
