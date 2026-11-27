"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, ChevronRight, Flag, Route, Trash2 } from "lucide-react";
import { addWorkingDays, criticalPath } from "@/lib/critical-path";
import { createBaselineAction, deleteBaselineAction, getBaselineAction, listBaselinesAction } from "@/actions/planning.actions";
import { useSignal } from "@/components/workspace/signals";
import type { TaskDTO } from "@/lib/realtime-protocol";
import { addDays, diffDays, formatMonth, formatShort, startOfWeek, todayISO, weekdayMon } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { PriorityFlag, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { groupByColumn } from "../board-state";
import type { TaskPatch, ViewProps } from "./types";

const ZOOMS = { week: { days: 21, label: "3 weeks" }, month: { days: 42, label: "6 weeks" }, quarter: { days: 91, label: "Quarter" } } as const;
type Zoom = keyof typeof ZOOMS;
const ROW = 46;
const GROUP = 44; // group header height (h-11)
const LEFT = 340;

type DragState = { taskId: string; mode: "move" | "start" | "end"; originX: number; delta: number };

/**
 * Gantt-style timeline. Bars span start → due (a task with only one date is a
 * one-day bar). Drag the bar to shift both dates; drag an edge to resize.
 * Changes go through the same optimistic + version-checked update as every edit.
 */
type BaselineRow = { id: string; name: string; createdAt: string; createdByName: string | null };
type BaselineData = { id: string; name: string; tasks: Map<string, { startDate: string | null; dueDate: string | null; slipDays: number | null }> };

export function TimelineView(props: ViewProps & { onPatch: (task: TaskDTO, patch: TaskPatch) => void; organizationId: string; projectId: string; canBaseline: boolean }) {
  const today = todayISO();
  const [showCritical, setShowCritical] = useState(false);
  const [baselineList, setBaselineList] = useState<BaselineRow[]>([]);
  const [baselineId, setBaselineId] = useState<string>("");
  const [baseline, setBaseline] = useState<BaselineData | null>(null);

  const loadBaselines = useCallback(async () => {
    const r = await listBaselinesAction(props.organizationId, props.projectId);
    if (r.ok) setBaselineList(r.baselines);
  }, [props.organizationId, props.projectId]);
  useEffect(() => void loadBaselines(), [loadBaselines]);
  useSignal((e) => e.type === "PLANNING_CHANGED" && e.projectId === props.projectId && void loadBaselines());

  useEffect(() => {
    if (!baselineId) return setBaseline(null);
    let live = true;
    void getBaselineAction(props.organizationId, baselineId).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setBaselineId("");
        return toast.error(r.message);
      }
      setBaseline({ id: r.baseline.id, name: r.baseline.name, tasks: new Map(r.baseline.tasks.map((t) => [t.taskId, t])) });
    });
    return () => void (live = false);
    // Re-fetch when tasks change so slip stays current.
  }, [baselineId, props.organizationId, props.tasks]);

  async function saveBaseline() {
    const name = window.prompt("Name this baseline", `Plan ${formatShort(today)}`);
    if (!name?.trim()) return;
    const r = await createBaselineAction(props.organizationId, props.projectId, name.trim());
    if (!r.ok) return toast.error(r.message);
    toast.success(`Baseline saved (${r.baseline.tasks} dated task${r.baseline.tasks === 1 ? "" : "s"})`);
    await loadBaselines();
    setBaselineId(r.baseline.id);
  }
  async function removeBaseline() {
    if (!baseline || !window.confirm(`Delete baseline "${baseline.name}"?`)) return;
    const r = await deleteBaselineAction(props.organizationId, props.projectId, baseline.id);
    if (!r.ok) return toast.error(r.message);
    setBaselineId("");
    await loadBaselines();
  }

  // Critical path over the whole project (filters shouldn't change the schedule's math).
  const cpm = useMemo(() => {
    if (!showCritical) return null;
    const list = Object.values(props.allTasks).map((t) => ({ id: t.id, startDate: t.startDate, dueDate: t.dueDate, estimateHours: t.estimateHours, done: t.columnId === props.doneColumnId }));
    return criticalPath(list, props.decor.deps, today);
  }, [showCritical, props.allTasks, props.decor.deps, props.doneColumnId, today]);
  const slip = useMemo(() => {
    if (!baseline) return null;
    let later = 0, earlier = 0, worst = 0;
    for (const [id, b] of baseline.tasks) {
      if (!props.allTasks[id] || b.slipDays === null) continue;
      if (b.slipDays > 0) later++;
      if (b.slipDays < 0) earlier++;
      worst = Math.max(worst, b.slipDays);
    }
    return { later, earlier, worst };
  }, [baseline, props.allTasks]);
  const [zoom, setZoom] = useState<Zoom>("month");
  const [from, setFrom] = useState(() => addDays(startOfWeek(today), -7));
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [drag, setDragState] = useState<DragState | null>(null);
  // Mirror in a ref so pointer handlers read the latest value without impure state updaters.
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const setDrag = (d: DragState | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(900);

  const span = ZOOMS[zoom].days;
  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(from, i)), [from, span]);
  const dayW = Math.max(18, trackWidth / span);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTrackWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const grouped = useMemo(() => groupByColumn(props.tasks, props.columns.map((c) => c.id)), [props.tasks, props.columns]);

  // Month bands for the header.
  const months = useMemo(() => {
    const out: { label: string; start: number; len: number }[] = [];
    days.forEach((d, i) => {
      const key = d.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.label === key) last.len++;
      else out.push({ label: key, start: i, len: 1 });
    });
    return out;
  }, [days]);

  /* -------------------------- drag to move/resize -------------------------- */
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) setDrag({ ...d, delta: Math.round((e.clientX - d.originX) / dayW) });
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (d && d.delta !== 0) {
        // The click that follows pointerup must not open the drawer.
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        commit(d);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.taskId, dayW]);

  function range(t: TaskDTO, d?: DragState | null): { start: string; end: string } | null {
    const s0 = t.startDate ?? t.dueDate;
    const e0 = t.dueDate ?? t.startDate;
    if (!s0 || !e0) return null;
    if (!d || d.taskId !== t.id || d.delta === 0) return { start: s0, end: e0 };
    if (d.mode === "move") return { start: addDays(s0, d.delta), end: addDays(e0, d.delta) };
    if (d.mode === "start") {
      const s = addDays(s0, d.delta);
      return { start: s > e0 ? e0 : s, end: e0 };
    }
    const e = addDays(e0, d.delta);
    return { start: s0, end: e < s0 ? s0 : e };
  }

  function commit(d: DragState) {
    const t = props.tasks[d.taskId];
    if (!t) return;
    const r = range(t, d);
    if (!r) return;
    const patch: TaskPatch = {};
    if (d.mode !== "end" || t.startDate) patch.startDate = r.start;
    if (d.mode !== "start" || t.dueDate) patch.dueDate = r.end;
    props.onPatch(t, patch);
  }

  const todayOffset = diffDays(from, today);

  /* Dependency arrows: rows have fixed heights, so geometry is computed, not measured. */
  const rowY = new Map<string, number>();
  {
    let y = 0;
    for (const col of props.columns) {
      y += GROUP;
      if (collapsed[col.id]) continue;
      for (const id of grouped[col.id] ?? []) {
        rowY.set(id, y + ROW / 2);
        y += ROW;
      }
    }
  }
  const arrows = props.decor.deps
    .map((d) => {
      const a = props.tasks[d.blockerId];
      const b = props.tasks[d.blockedId];
      if (!a || !b) return null;
      const ra = range(a, drag);
      const rb = range(b, drag);
      const ya = rowY.get(a.id);
      const yb = rowY.get(b.id);
      if (!ra || !rb || ya === undefined || yb === undefined) return null;
      const x1 = (diffDays(from, ra.end) + 1) * dayW - 2; // end of blocker bar
      const x2 = diffDays(from, rb.start) * dayW + 2; // start of blocked bar
      const open = a.columnId !== props.doneColumnId;
      // Elbow: out to the right, across vertically, then into the blocked bar.
      const midX = x2 - 10 >= x1 + 10 ? (x1 + x2) / 2 : x1 + 10;
      const path =
        x2 - 10 >= x1 + 10
          ? `M${x1},${ya} H${midX} V${yb} H${x2}`
          : `M${x1},${ya} H${x1 + 10} V${(ya + yb) / 2} H${x2 - 10} V${yb} H${x2}`;
      const crit = !!cpm && cpm.critical.has(a.id) && cpm.critical.has(b.id);
      return { key: `${d.blockerId}-${d.blockedId}`, path, open, x2, yb, late: rb.start <= ra.end, crit };
    })
    .filter(Boolean) as { key: string; path: string; open: boolean; x2: number; yb: number; late: boolean; crit: boolean }[];

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* toolbar */}
      <div className="flex items-center gap-2 px-8 py-4">
        <Button variant="outline" size="sm" onClick={() => setFrom(addDays(startOfWeek(today), -7))}>Today</Button>
        <Button variant="ghost" size="icon" aria-label="Earlier" onClick={() => setFrom((f) => addDays(f, -Math.round(span / 3)))}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Later" onClick={() => setFrom((f) => addDays(f, Math.round(span / 3)))}>
          <ChevronRight className="h-5 w-5" />
        </Button>
        <h2 className="ml-1 text-xl font-bold tracking-tight">
          {formatShort(days[0]!)} – {formatShort(days[days.length - 1]!)}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant={showCritical ? "default" : "outline"} size="sm" onClick={() => setShowCritical((v) => !v)} aria-pressed={showCritical}>
            <Route className="h-4 w-4" /> Critical path
          </Button>
          <label className="sr-only" htmlFor="tl-baseline">Compare with baseline</label>
          <select
            id="tl-baseline"
            value={baselineId}
            onChange={(e) => setBaselineId(e.target.value)}
            className="h-9 rounded-lg border border-border bg-white px-2.5 text-[14px] text-foreground"
          >
            <option value="">No baseline</option>
            {baselineList.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {props.canBaseline && baseline && (
            <Button variant="ghost" size="icon" aria-label="Delete this baseline" onClick={removeBaseline}><Trash2 className="h-4 w-4" /></Button>
          )}
          {props.canBaseline && (
            <Button variant="outline" size="sm" onClick={saveBaseline}><Flag className="h-4 w-4" /> Save baseline</Button>
          )}
        </div>
        <div className="flex rounded-lg border border-border bg-surface-2 p-0.5">
          {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1.5 text-[14px] font-medium transition-colors",
                zoom === z ? "bg-white text-foreground shadow-card" : "text-muted hover:text-foreground"
              )}
            >
              {ZOOMS[z].label}
            </button>
          ))}
        </div>
      </div>

      {(cpm || slip) && (
        <div className="mx-8 mb-3 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border bg-surface-2 px-4 py-2 text-[14px] text-muted">
          {cpm && (cpm.chain.length ? (
            <span>
              <b className="text-rose-700">Critical path:</b> {cpm.chain.length} task{cpm.chain.length === 1 ? "" : "s"} ·{" "}
              {cpm.length} working day{cpm.length === 1 ? "" : "s"} · earliest finish <b className="text-foreground">{formatShort(addWorkingDays(cpm.base, Math.max(0, cpm.length - 1)))}</b>.
              {" "}A delay on any red bar moves the end date.
            </span>
          ) : <span>No open work to schedule.</span>)}
          {slip && baseline && (
            <span>
              <b className="text-foreground">vs. {baseline.name}:</b>{" "}
              {slip.later ? <span className="text-amber-700">{slip.later} task{slip.later === 1 ? "" : "s"} later (worst +{slip.worst}d)</span> : "nothing slipped"}
              {slip.earlier ? `, ${slip.earlier} earlier` : ""}. Grey bars show the saved plan.
            </span>
          )}
        </div>
      )}

      <div className="mx-8 mb-6 flex min-h-0 flex-1 overflow-auto rounded-xl border border-border">
        <div className="relative min-w-fit flex-1">
          {/* header */}
          <div className="sticky top-0 z-20 flex border-b border-border bg-white">
            <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-border bg-white px-4 pb-2 text-[13px] font-semibold uppercase tracking-wide text-subtle" style={{ width: LEFT }}>
              Task
            </div>
            <div ref={trackRef} className="min-w-0 flex-1">
              <div className="relative h-7 border-b border-border">
                {months.map((m) => (
                  <div key={m.label} className="absolute top-0 flex h-full items-center border-l border-border px-2 text-[13px] font-semibold" style={{ left: m.start * dayW, width: m.len * dayW }}>
                    <span className="truncate">{formatMonth(`${m.label}-01`)}</span>
                  </div>
                ))}
              </div>
              <div className="flex">
                {days.map((d) => (
                  <div
                    key={d}
                    className={cn(
                      "flex shrink-0 flex-col items-center justify-center border-l border-border py-1 text-[12px]",
                      weekdayMon(d) >= 5 ? "bg-surface-2 text-subtle" : "text-muted",
                      d === today && "bg-primary-soft font-bold text-primary"
                    )}
                    style={{ width: dayW }}
                  >
                    {dayW >= 26 && <span className="text-[10.5px] uppercase">{["M", "T", "W", "T", "F", "S", "S"][weekdayMon(d)]}</span>}
                    <span>{Number(d.slice(8))}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* body */}
          <div className="relative">
            {/* dependency arrows (blocker end → blocked start) */}
            {arrows.length > 0 && (
              <svg className="pointer-events-none absolute top-0 z-[5] overflow-visible" style={{ left: LEFT, width: span * dayW, height: "100%" }} aria-hidden>
                {arrows.map((a) => {
                  const color = a.crit ? "#be123c" : a.open ? (a.late ? "#dc2626" : "#e86a6a") : "#9aa1ab";
                  return (
                    <g key={a.key} opacity={cpm && !a.crit ? 0.35 : 1}>
                      <path d={a.path} fill="none" stroke={color} strokeWidth={a.crit ? 2.75 : 1.75} strokeLinejoin="round" strokeDasharray={a.open ? undefined : "4 3"} />
                      <path d={`M${a.x2},${a.yb} l-6,-4 v8 z`} fill={color} />
                    </g>
                  );
                })}
              </svg>
            )}
            {/* weekend shading + today line spanning all rows */}
            <div className="pointer-events-none absolute inset-y-0 z-0" style={{ left: LEFT, right: 0 }}>
              {days.map((d, i) =>
                weekdayMon(d) >= 5 ? <div key={d} className="absolute inset-y-0 bg-surface-2/70" style={{ left: i * dayW, width: dayW }} /> : null
              )}
              {todayOffset >= 0 && todayOffset < span && (
                <div className="absolute inset-y-0 z-10 w-0.5 bg-primary" style={{ left: todayOffset * dayW + dayW / 2 }}>
                  <span className="absolute -left-[3px] top-0 h-2 w-2 rounded-full bg-primary" />
                </div>
              )}
            </div>

            {props.columns.map((col, ci) => {
              const ids = grouped[col.id] ?? [];
              const color = props.colorOf(ci);
              const done = col.id === props.doneColumnId;
              return (
                <div key={col.id}>
                  <div className="sticky left-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-white/95 px-3" style={{ width: LEFT }}>
                    <button
                      onClick={() => setCollapsed((c) => ({ ...c, [col.id]: !c[col.id] }))}
                      className="cursor-pointer rounded p-0.5 text-subtle hover:bg-hover"
                      aria-label="Toggle group"
                    >
                      <ChevronDown className={cn("h-4 w-4 transition-transform", collapsed[col.id] && "-rotate-90")} />
                    </button>
                    <StatusPill title={col.title} color={color} count={ids.length} />
                  </div>
                  {!collapsed[col.id] &&
                    ids.map((id) => {
                      const t = props.tasks[id]!;
                      const r = range(t, drag);
                      const assignee = t.assigneeId ? props.memberById.get(t.assigneeId) : undefined;
                      const left = r ? diffDays(from, r.start) * dayW : 0;
                      const width = r ? (diffDays(r.start, r.end) + 1) * dayW : 0;
                      const visible = r && left + width > 0 && left < span * dayW;
                      const dragging = drag?.taskId === t.id;
                      const bl = baseline?.tasks.get(t.id);
                      const bs = bl ? (bl.startDate ?? bl.dueDate) : null;
                      const be = bl ? (bl.dueDate ?? bl.startDate) : null;
                      const bLeft = bs ? diffDays(from, bs) * dayW : 0;
                      const bWidth = bs && be ? (diffDays(bs, be) + 1) * dayW : 0;
                      const isCrit = !!cpm?.critical.has(t.id);
                      const slackDays = cpm?.slack.get(t.id);
                      const tip = [
                        `${props.refOf(t)} · ${r?.start} → ${r?.end}`,
                        cpm && slackDays !== undefined ? (isCrit ? "Critical: no slack" : `Slack: ${slackDays} working day${slackDays === 1 ? "" : "s"}`) : null,
                        bl && bl.slipDays ? `${bl.slipDays > 0 ? "+" : ""}${bl.slipDays}d vs. baseline (${bs} → ${be})` : bl ? "On baseline" : null,
                      ].filter(Boolean).join("\n");
                      return (
                        <div key={id} className={cn("group flex border-b border-border/70 hover:bg-[#fafafe]", props.flash[id] && "animate-flash")} style={{ height: ROW }}>
                          <button
                            onClick={() => props.onOpen(id)}
                            className="sticky left-0 z-10 flex shrink-0 cursor-pointer items-center gap-2.5 border-r border-border bg-white px-4 text-left group-hover:bg-[#fafafe]"
                            style={{ width: LEFT }}
                          >
                            <span className="h-3 w-3 shrink-0 rounded-full border-2" style={{ borderColor: color, backgroundColor: done ? color : "transparent" }} />
                            <span className={cn("min-w-0 flex-1 truncate text-[14.5px] font-medium", done && "text-muted line-through")}>{t.title}</span>
                            <PriorityFlag priority={t.priority} size={13} />
                            {assignee && <Avatar id={assignee.id} name={assignee.name} src={assignee.avatarUrl} size={22} />}
                          </button>
                          <div className="relative min-w-0 flex-1">
                            {bs && be && bLeft + bWidth > 0 && bLeft < span * dayW && (
                              <div
                                className="pointer-events-none absolute bottom-1 h-1.5 rounded-full bg-slate-400/70"
                                style={{ left: Math.max(bLeft, 0) + 2, width: Math.max(bWidth - 4, 6) }}
                                aria-hidden
                              />
                            )}
                            {bl?.slipDays ? (
                              <span className={cn("pointer-events-none absolute right-2 top-1 z-[6] rounded px-1 text-[11px] font-bold", bl.slipDays > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>
                                {bl.slipDays > 0 ? "+" : ""}{bl.slipDays}d
                              </span>
                            ) : null}
                            {!r && (
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-subtle opacity-0 transition-opacity group-hover:opacity-100">
                                No dates — open the task to schedule it
                              </span>
                            )}
                            {visible && (
                              <div
                                className={cn(
                                  "absolute top-1/2 flex h-7 -translate-y-1/2 items-center overflow-hidden rounded-md text-[12.5px] font-semibold text-white shadow-card transition-shadow",
                                  props.canEdit && "cursor-grab active:cursor-grabbing hover:shadow-lift",
                                  dragging && "shadow-glow",
                                  baseline && "-mt-1",
                                  isCrit && "ring-2 ring-rose-600 ring-offset-1",
                                  cpm && !isCrit && "opacity-45"
                                )}
                                style={{ left: Math.max(left, 0) + 2, width: Math.max(width - 4, 10), backgroundColor: isCrit ? "#e11d48" : color }}
                                title={tip}
                                data-critical={isCrit || undefined}
                                onPointerDown={(e) => {
                                  if (!props.canEdit) return;
                                  e.preventDefault();
                                  setDrag({ taskId: t.id, mode: "move", originX: e.clientX, delta: 0 });
                                }}
                                onClick={() => !suppressClick.current && props.onOpen(t.id)}
                              >
                                {props.canEdit && (
                                  <span
                                    className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-black/0 hover:bg-black/15"
                                    onPointerDown={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      setDrag({ taskId: t.id, mode: "start", originX: e.clientX, delta: 0 });
                                    }}
                                  />
                                )}
                                <span className="truncate px-2.5">{width > 70 ? t.title : props.refOf(t)}</span>
                                {props.canEdit && (
                                  <span
                                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/0 hover:bg-black/15"
                                    onPointerDown={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      setDrag({ taskId: t.id, mode: "end", originX: e.clientX, delta: 0 });
                                    }}
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
