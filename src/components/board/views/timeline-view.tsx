"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
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
const LEFT = 340;

type DragState = { taskId: string; mode: "move" | "start" | "end"; originX: number; delta: number };

/**
 * Gantt-style timeline. Bars span start → due (a task with only one date is a
 * one-day bar). Drag the bar to shift both dates; drag an edge to resize.
 * Changes go through the same optimistic + version-checked update as every edit.
 */
export function TimelineView(props: ViewProps & { onPatch: (task: TaskDTO, patch: TaskPatch) => void }) {
  const today = todayISO();
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
        <div className="ml-auto flex rounded-lg border border-border bg-surface-2 p-0.5">
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
                                  dragging && "shadow-glow"
                                )}
                                style={{ left: Math.max(left, 0) + 2, width: Math.max(width - 4, 10), backgroundColor: color }}
                                title={`${props.refOf(t)} · ${r.start} → ${r.end}`}
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
