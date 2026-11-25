"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Layers, ListChecks, Table2, BarChart3 } from "lucide-react";
import type { TaskPriority } from "@/db/schema";
import type { TaskDTO } from "@/lib/realtime-protocol";
import { diffDays, dueState, formatShort, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { projectFlowSeriesAction } from "@/actions/task.actions";
import { Avatar } from "@/components/ui/avatar";
import { DONE_COLOR, PRIORITY_STYLE, PriorityFlag, STATUS_SLOTS } from "@/components/ui/badge";
import { DueChip } from "../task-meta";
import type { ViewProps } from "./types";

/* Chart tokens. Marks carry series color; all text uses ink tokens (never the series color). */
const GRID = "#e8eaed";
const BAR_MAX = 22; // bar thickness cap (<= 24px)
const SINGLE = "#8a5cf6"; // single-series magnitude color (validated status slot 2)
const CREATED = STATUS_SLOTS[0]; // validated pair: #3f7cb8 / #0f9d74
const COMPLETED = DONE_COLOR;

type Tip = { x: number; y: number; lines: React.ReactNode } | null;

/* --------------------------------- shell -------------------------------- */

function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string }[];
  table: React.ReactNode;
  children: (setTip: (t: Tip) => void) => React.ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const [tip, setTip] = useState<Tip>(null);
  const ref = useRef<HTMLDivElement>(null);
  const place = (t: Tip) => {
    if (!t || !ref.current) return setTip(t);
    const r = ref.current.getBoundingClientRect();
    setTip({ ...t, x: t.x - r.left, y: t.y - r.top });
  };
  return (
    <section className={cn("relative flex flex-col rounded-xl border border-border bg-white p-5 shadow-card", className)}>
      <header className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="text-[13.5px] text-subtle">{subtitle}</p>}
        </div>
        <button
          onClick={() => setAsTable((v) => !v)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-muted hover:bg-hover hover:text-foreground"
          aria-pressed={asTable}
        >
          {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          {asTable ? "Chart" : "Table"}
        </button>
      </header>
      {legend && !asTable && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {legend.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <div ref={ref} className="relative flex-1" onMouseLeave={() => setTip(null)}>
        {asTable ? <div className="max-h-80 overflow-auto">{table}</div> : children(place)}
        {tip && !asTable && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-20 min-w-36 rounded-lg border border-border bg-white px-3 py-2 text-[13px] shadow-lift"
            style={{ left: Math.min(tip.x + 14, (ref.current?.clientWidth ?? 400) - 170), top: Math.max(tip.y - 12, 0) }}
          >
            {tip.lines}
          </div>
        )}
      </div>
    </section>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-[14px]">
      <thead>
        <tr className="border-b border-border text-left text-[12.5px] uppercase tracking-wide text-subtle">
          {head.map((h, i) => (
            <th key={h} className={cn("py-1.5 font-semibold", i > 0 && "text-right")}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border/60">
            {r.map((c, j) => (
              <td key={j} className={cn("py-1.5", j > 0 ? "text-right tabular-nums text-muted" : "text-foreground")}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------- bar charts ------------------------------ */

type Segment = { key: string; label: string; value: number; color: string };
type BarRow = { key: string; label: React.ReactNode; tipLabel: string; segments: Segment[] };

/** Horizontal bars (single or stacked). 2px surface gaps, 4px rounded data-end, square baseline. */
function HBars({ rows, setTip, labelWidth = 150 }: { rows: BarRow[]; setTip: (t: Tip) => void; labelWidth?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.segments.reduce((s, x) => s + x.value, 0)));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const total = r.segments.reduce((s, x) => s + x.value, 0);
        const live = r.segments.filter((s) => s.value > 0);
        return (
          <div key={r.key} className="flex items-center gap-3">
            <div className="shrink-0 truncate text-[14px] text-foreground" style={{ width: labelWidth }}>{r.label}</div>
            <div className="relative flex flex-1 items-center" style={{ height: BAR_MAX + 6 }}>
              <div className="absolute inset-y-0 left-0 w-px" style={{ backgroundColor: GRID }} />
              <div className="flex h-full items-center gap-[2px]" style={{ width: `${(total / max) * 100}%`, minWidth: total ? 4 : 0 }}>
                {live.map((s, i) => (
                  <div
                    key={s.key}
                    // Hit target is the full row height; the visible mark is capped thinner.
                    className="flex h-full cursor-default items-center"
                    style={{ flexGrow: s.value, flexBasis: 0 }}
                    onMouseMove={(e) =>
                      setTip({
                        x: e.clientX,
                        y: e.clientY,
                        lines: (
                          <>
                            <div className="font-semibold text-foreground">{r.tipLabel}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-muted">
                              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                              {s.label}: <b className="text-foreground">{s.value}</b>
                            </div>
                          </>
                        ),
                      })
                    }
                  >
                    <div
                      className="w-full transition-opacity hover:opacity-85"
                      style={{
                        height: BAR_MAX,
                        backgroundColor: s.color,
                        borderRadius: i === live.length - 1 ? "0 4px 4px 0" : 0,
                      }}
                    />
                  </div>
                ))}
              </div>
              <span className="ml-2 text-[13px] font-semibold tabular-nums text-muted">{total}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------- created vs completed ---------------------------- */

function FlowColumns({ series, setTip }: { series: { day: string; created: number; completed: number }[]; setTip: (t: Tip) => void }) {
  const H = 180;
  const max = Math.max(2, ...series.flatMap((s) => [s.created, s.completed]));
  const step = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const colW = 9;
  return (
    <div className="flex gap-2">
      <div className="relative shrink-0 text-right text-[12px] tabular-nums text-subtle" style={{ height: H, width: 24 }}>
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / top) * H }}>{t}</span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height: H }}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px" style={{ top: H - (t / top) * H, backgroundColor: GRID }} />
          ))}
          <div className="absolute inset-0 flex">
            {series.map((s) => (
              <div
                key={s.day}
                className="group flex flex-1 items-end justify-center gap-[2px] hover:bg-surface-2/70"
                onMouseMove={(e) =>
                  setTip({
                    x: e.clientX,
                    y: e.clientY,
                    lines: (
                      <>
                        <div className="font-semibold text-foreground">{formatShort(s.day)}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-muted">
                          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: CREATED }} /> Created: <b className="text-foreground">{s.created}</b>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted">
                          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COMPLETED }} /> Completed: <b className="text-foreground">{s.completed}</b>
                        </div>
                      </>
                    ),
                  })
                }
              >
                {[
                  [s.created, CREATED],
                  [s.completed, COMPLETED],
                ].map(([v, c], i) => (
                  <div
                    key={i}
                    style={{ width: colW, height: Number(v) ? Math.max(3, (Number(v) / top) * H) : 0, backgroundColor: String(c), borderRadius: "4px 4px 0 0" }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-1.5 flex text-[11.5px] text-subtle">
          {series.map((s, i) => (
            <span key={s.day} className="flex-1 text-center">{i % 2 === 0 || series.length <= 8 ? Number(s.day.slice(8)) : ""}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- tiles -------------------------------- */

function Stat({ icon: Icon, label, value, detail, tone }: { icon: typeof Layers; label: string; value: React.ReactNode; detail?: React.ReactNode; tone?: "critical" | "good" }) {
  return (
    <div className="rounded-xl border border-border bg-white p-5 shadow-card">
      <div className="flex items-center gap-2 text-[14px] font-medium text-muted">
        <Icon className={cn("h-4 w-4", tone === "critical" ? "text-red-600" : tone === "good" ? "text-emerald-700" : "text-subtle")} />
        {label}
      </div>
      <div className="mt-2 text-[34px] font-bold leading-none tracking-tight tabular-nums">{value}</div>
      {detail && <div className="mt-2 text-[13.5px] text-subtle">{detail}</div>}
    </div>
  );
}

/* --------------------------------- view --------------------------------- */

export function DashboardView(props: ViewProps & { organizationId: string; projectId: string; filtered: boolean }) {
  const today = todayISO();
  const tasks = useMemo(() => Object.values(props.tasks), [props.tasks]);
  const isDone = (t: TaskDTO) => t.columnId === props.doneColumnId;

  const [series, setSeries] = useState<{ day: string; created: number; completed: number }[] | null>(null);
  // Refetch (debounced) whenever task versions change, so live updates reach the chart.
  const versionKey = useMemo(() => tasks.reduce((s, t) => s + t.version, 0) + tasks.length * 1000, [tasks]);
  useEffect(() => {
    const id = setTimeout(async () => {
      const r = await projectFlowSeriesAction(props.organizationId, props.projectId, 14);
      if (r.ok) setSeries(r.series);
    }, 400);
    return () => clearTimeout(id);
  }, [props.organizationId, props.projectId, versionKey]);

  const done = tasks.filter(isDone);
  const overdue = tasks.filter((t) => dueState(t.dueDate, isDone(t), today) === "overdue");
  const atRisk = tasks
    .filter((t) => !isDone(t) && t.dueDate && diffDays(today, t.dueDate) <= 3)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const pts = tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
  const ptsDone = done.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
  const pct = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0;

  const statusRows: BarRow[] = props.columns.map((c, i) => {
    const n = tasks.filter((t) => t.columnId === c.id).length;
    return { key: c.id, label: c.title, tipLabel: c.title, segments: [{ key: c.id, label: "Tasks", value: n, color: props.colorOf(i) }] };
  });

  const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"];
  const priorityRows: BarRow[] = PRIORITIES.map((p) => ({
    key: p,
    label: (
      <span className="inline-flex items-center gap-2">
        <PriorityFlag priority={p} /> {PRIORITY_STYLE[p].label}
      </span>
    ),
    tipLabel: `${PRIORITY_STYLE[p].label} priority`,
    segments: [{ key: p, label: "Open tasks", value: tasks.filter((t) => t.priority === p && !isDone(t)).length, color: SINGLE }],
  }));

  const people = [...props.memberById.values()];
  const workloadRows: BarRow[] = [
    ...people.map((m) => ({ id: m.id, name: m.name, m })),
    { id: "__none", name: "Unassigned", m: null },
  ]
    .map(({ id, name, m }) => ({
      key: id,
      label: (
        <span className="inline-flex min-w-0 items-center gap-2">
          {m ? <Avatar id={m.id} name={m.name} src={m.avatarUrl} size={22} /> : <span className="h-[22px] w-[22px] shrink-0 rounded-full border border-dashed border-border-strong" />}
          <span className="truncate">{name}</span>
        </span>
      ),
      tipLabel: name,
      segments: props.columns.map((c, i) => ({
        key: c.id,
        label: c.title,
        value: tasks.filter((t) => (t.assigneeId ?? "__none") === id && t.columnId === c.id).length,
        color: props.colorOf(i),
      })),
    }))
    .filter((r) => r.segments.some((s) => s.value > 0))
    .sort((a, b) => b.segments.reduce((s, x) => s + x.value, 0) - a.segments.reduce((s, x) => s + x.value, 0));

  const statusLegend = props.columns.map((c, i) => ({ label: c.title, color: props.colorOf(i) }));

  return (
    <div className="flex-1 overflow-auto bg-canvas px-8 py-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Layers} label="Total tasks" value={tasks.length} detail={`${tasks.length - done.length} open`} />
        <Stat icon={CheckCircle2} tone="good" label="Completed" value={`${pct}%`} detail={`${done.length} of ${tasks.length} tasks done`} />
        <Stat
          icon={AlertTriangle}
          tone={overdue.length ? "critical" : undefined}
          label="Overdue"
          value={overdue.length}
          detail={overdue.length ? "Past due and not done" : "Nothing overdue"}
        />
        <Stat icon={ListChecks} label="Story points" value={`${ptsDone}/${pts}`} detail={pts ? `${Math.round((ptsDone / pts) * 100)}% of points delivered` : "No estimates yet"} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Tasks by status"
          subtitle="Current distribution across the board"
          table={<DataTable head={["Status", "Tasks"]} rows={statusRows.map((r) => [r.tipLabel, r.segments[0]!.value])} />}
        >
          {(setTip) => <HBars rows={statusRows} setTip={setTip} />}
        </ChartCard>

        <ChartCard
          title="Created vs completed"
          subtitle={props.filtered ? "Last 14 days · whole project (filters don't apply)" : "Last 14 days"}
          legend={[
            { label: "Created", color: CREATED },
            { label: "Completed", color: COMPLETED },
          ]}
          table={<DataTable head={["Day", "Created", "Completed"]} rows={(series ?? []).map((s) => [formatShort(s.day), s.created, s.completed])} />}
        >
          {(setTip) => (series ? <FlowColumns series={series} setTip={setTip} /> : <div className="h-48 animate-pulse rounded-lg bg-surface-2" />)}
        </ChartCard>

        <ChartCard
          title="Workload by assignee"
          subtitle="Tasks per person, split by status"
          legend={statusLegend}
          table={
            <DataTable
              head={["Assignee", ...props.columns.map((c) => c.title), "Total"]}
              rows={workloadRows.map((r) => [r.tipLabel, ...r.segments.map((s) => s.value), r.segments.reduce((s, x) => s + x.value, 0)])}
            />
          }
        >
          {(setTip) => (workloadRows.length ? <HBars rows={workloadRows} setTip={setTip} labelWidth={170} /> : <p className="text-[14px] text-subtle">No tasks match the current filters.</p>)}
        </ChartCard>

        <ChartCard
          title="Open work by priority"
          subtitle="Tasks not yet done"
          table={<DataTable head={["Priority", "Open tasks"]} rows={priorityRows.map((r) => [r.tipLabel, r.segments[0]!.value])} />}
        >
          {(setTip) => <HBars rows={priorityRows} setTip={setTip} />}
        </ChartCard>
      </div>

      <section className="mt-4 rounded-xl border border-border bg-white p-5 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <h3 className="text-[16px] font-semibold tracking-tight">At risk</h3>
          <span className="text-[13.5px] text-subtle">Overdue or due within 3 days</span>
        </div>
        {atRisk.length === 0 ? (
          <p className="text-[14px] text-subtle">Nothing at risk. 🎉</p>
        ) : (
          <div className="divide-y divide-border">
            {atRisk.map((t) => {
              const a = t.assigneeId ? props.memberById.get(t.assigneeId) : undefined;
              const ci = props.columns.findIndex((c) => c.id === t.columnId);
              return (
                <button key={t.id} onClick={() => props.onOpen(t.id)} className="flex w-full cursor-pointer items-center gap-3 py-2.5 text-left hover:bg-[#fafafe]">
                  <span className="h-3 w-3 shrink-0 rounded-full border-2" style={{ borderColor: props.colorOf(ci) }} />
                  <span className="w-20 shrink-0 text-[13.5px] text-subtle">{props.refOf(t)}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{t.title}</span>
                  <span className="hidden w-28 text-[13.5px] text-muted sm:block">{props.columns[ci]?.title}</span>
                  <PriorityFlag priority={t.priority} />
                  {a ? <Avatar id={a.id} name={a.name} src={a.avatarUrl} size={24} /> : <span className="w-6" />}
                  <DueChip due={t.dueDate} done={false} className="w-28 justify-center" />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
