"use client";

import { useMemo, useRef, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { formatShort, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DONE_COLOR, STATUS_SLOTS } from "@/components/ui/badge";

/* Validated pair (#3f7cb8 / #0f9d74) for two-series charts; remaining uses status slot 2. */
export const SCOPE_COLOR = STATUS_SLOTS[0];
export const COMPLETED_COLOR = DONE_COLOR;
export const REMAINING_COLOR = STATUS_SLOTS[1];
const IDEAL_COLOR = "#9aa1ab"; // neutral reference line, never a data series
const GRID = "#e8eaed";

export type Series = { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean; reference?: boolean };

function niceTicks(max: number) {
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
  const top = Math.max(step, Math.ceil(max / step) * step);
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
}

/** Shell: title, legend (always for >= 2 series), chart/table toggle. */
export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: { label: string; color: string; dashed?: boolean }[];
  table: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="rounded-xl border border-border bg-white p-5 shadow-card">
      <header className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="truncate text-[13.5px] text-subtle">{subtitle}</p>}
        </div>
        <button
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-muted hover:bg-hover hover:text-foreground"
        >
          {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          {asTable ? "Chart" : "Table"}
        </button>
      </header>
      {actions && <div className="mb-3 flex flex-wrap items-center gap-2">{actions}</div>}
      {legend && !asTable && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {legend.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              {l.dashed ? (
                <svg width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke={l.color} strokeWidth="2" strokeDasharray="4 3" /></svg>
              ) : (
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
              )}
              {l.label}
            </span>
          ))}
        </div>
      )}
      {asTable ? <div className="max-h-72 overflow-auto">{table}</div> : children}
    </section>
  );
}

export function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-[14px]">
      <thead>
        <tr className="border-b border-border text-left text-[12.5px] uppercase tracking-wide text-subtle">
          {head.map((h, i) => <th key={h} className={cn("py-1.5 font-semibold", i > 0 && "text-right")}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-border/60">
            {r.map((c, j) => <td key={j} className={cn("py-1.5", j > 0 ? "text-right tabular-nums text-muted" : "")}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Day-indexed line chart with a crosshair + tooltip. `null` values are not drawn (future days). */
export function LineChart({ days, series, height = 220 }: { days: string[]; series: Series[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 12, t: 10, b: 24 };
  const max = Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const { top, ticks } = niceTicks(max);
  const x = (i: number) => pad.l + (days.length <= 1 ? 0 : (i / (days.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const today = todayISO();
  const todayIdx = days.indexOf(today);
  const labelEvery = Math.max(1, Math.ceil(days.length / 7));

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = "";
        let pen = false;
        s.values.forEach((v, i) => {
          if (v === null) {
            pen = false;
            return;
          }
          d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
          pen = true;
        });
        return d;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, days.length, top]
  );

  const onMove = (e: React.MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || days.length === 0) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (days.length - 1));
    setHover(Math.max(0, Math.min(days.length - 1, i)));
  };

  return (
    <div ref={ref} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Line chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
            <text x={pad.l - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#8f949c">{t}</text>
          </g>
        ))}
        {days.map((d, i) =>
          i % labelEvery === 0 || i === days.length - 1 ? (
            <text key={d} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="#8f949c">{formatShort(d)}</text>
          ) : null
        )}
        {todayIdx >= 0 && <line x1={x(todayIdx)} x2={x(todayIdx)} y1={pad.t} y2={H - pad.b} stroke="#7b68ee" strokeWidth="1.5" strokeDasharray="3 3" />}
        {series.map((s, si) => (
          <path
            key={s.key}
            d={paths[si]}
            fill="none"
            stroke={s.color}
            strokeWidth={s.reference ? 1.5 : 2}
            strokeDasharray={s.dashed ? "5 4" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {/* end-point markers with a surface ring */}
        {series
          .filter((s) => !s.reference)
          .map((s) => {
            const last = s.values.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
            return last >= 0 ? <circle key={s.key} cx={x(last)} cy={y(s.values[last]!)} r="4.5" fill={s.color} stroke="#fff" strokeWidth="2" /> : null;
          })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="#c9cdd3" strokeWidth="1" />
            {series.map((s) =>
              s.values[hover] !== null && s.values[hover] !== undefined ? (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />
              ) : null
            )}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-border bg-white px-3 py-2 text-[13px] shadow-lift"
          style={{ left: `min(calc(${(x(hover) / W) * 100}% + 12px), calc(100% - 170px))` }}
        >
          <div className="font-semibold">{formatShort(days[hover]!)}</div>
          {series.map((s) => (
            <div key={s.key} className="mt-0.5 flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}: <b className="text-foreground">{s.values[hover] ?? "—"}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Committed vs completed points per sprint (grouped columns, 4px rounded caps, <= 24px thick). */
export function VelocityChart({ data }: { data: { id: string; name: string; committed: number; completed: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const H = 190;
  const max = Math.max(1, ...data.flatMap((d) => [d.committed, d.completed]));
  const { top, ticks } = niceTicks(max);
  if (data.length === 0) return <p className="py-10 text-center text-[14px] text-subtle">Complete a sprint to start tracking velocity.</p>;
  return (
    <div className="flex gap-2">
      <div className="relative shrink-0 text-right text-[11.5px] tabular-nums text-subtle" style={{ height: H, width: 26 }}>
        {ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / top) * H }}>{t}</span>)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <div key={t} className="absolute inset-x-0 h-px" style={{ top: H - (t / top) * H, backgroundColor: GRID }} />)}
          <div className="absolute inset-0 flex">
            {data.map((d, i) => (
              <div key={d.id} className={cn("relative flex flex-1 items-end justify-center gap-[2px]", hover === i && "bg-surface-2/70")} onMouseEnter={() => setHover(i)}>
                {[
                  [d.committed, SCOPE_COLOR],
                  [d.completed, COMPLETED_COLOR],
                ].map(([v, c], j) => (
                  <div key={j} style={{ width: 18, height: Number(v) ? Math.max(3, (Number(v) / top) * H) : 0, backgroundColor: String(c), borderRadius: "4px 4px 0 0" }} />
                ))}
                {hover === i && (
                  <div role="tooltip" className="pointer-events-none absolute bottom-full z-10 mb-2 min-w-40 rounded-lg border border-border bg-white px-3 py-2 text-[13px] shadow-lift">
                    <div className="font-semibold">{d.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: SCOPE_COLOR }} /> Committed: <b className="text-foreground">{d.committed}</b></div>
                    <div className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COMPLETED_COLOR }} /> Completed: <b className="text-foreground">{d.completed}</b></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-1.5 flex text-[12px] text-subtle">
          {data.map((d) => <span key={d.id} className="flex-1 truncate px-1 text-center">{d.name}</span>)}
        </div>
      </div>
    </div>
  );
}

export { IDEAL_COLOR };
