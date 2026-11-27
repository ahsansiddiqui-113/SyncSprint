"use client";

import { useEffect, useState } from "react";
import { Activity, Clock3, Gauge, TrendingUp } from "lucide-react";
import { flowMetricsAction } from "@/actions/task.actions";
import { formatShort } from "@/lib/dates";
import { ChartCard, DataTable, type Tip } from "./dashboard-view";

type Flow = Extract<Awaited<ReturnType<typeof flowMetricsAction>>, { ok: true }>;

const W = 640;
const H = 220;
const PAD = { l: 34, r: 8, t: 8, b: 22 };

/**
 * Flow analytics on the Dashboard (Azure Boards style): cumulative flow, cycle time
 * scatter with 50th/85th percentile lines, and weekly throughput. Whole project, from history.
 */
export function FlowAnalytics({ organizationId, projectId, colorOf, versionKey }: { organizationId: string; projectId: string; colorOf: (i: number) => string; versionKey: number }) {
  const [days, setDays] = useState(30);
  const [flow, setFlow] = useState<Flow | null>(null);
  useEffect(() => {
    const id = setTimeout(async () => {
      const r = await flowMetricsAction(organizationId, projectId, days);
      if (r.ok) setFlow(r);
    }, 500);
    return () => clearTimeout(id);
  }, [organizationId, projectId, days, versionKey]);

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 text-[18px] font-bold tracking-tight"><Activity className="h-5 w-5 text-primary" /> Flow</h2>
        <span className="text-[13.5px] text-subtle">How work moves through the board · whole project</span>
        <div className="ml-auto flex rounded-lg border border-border bg-white p-0.5 text-[13.5px]" role="radiogroup" aria-label="Period">
          {[14, 30, 90].map((d) => (
            <button key={d} role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={`cursor-pointer rounded-md px-2.5 py-1 font-medium ${days === d ? "bg-primary-soft text-primary" : "text-muted"}`}>{d} days</button>
          ))}
        </div>
      </div>
      {!flow ? (
        <div className="h-64 animate-pulse rounded-xl bg-surface-2" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Clock3} label="Cycle time (median)" value={flow.cycle.p50 === null ? "—" : `${flow.cycle.p50} d`} detail={flow.cycle.p85 === null ? "No finished work yet" : `85% finish within ${flow.cycle.p85} d`} />
            <Metric icon={TrendingUp} label="Lead time (median)" value={flow.lead.p50 === null ? "—" : `${flow.lead.p50} d`} detail={flow.lead.avg === null ? "Created → done" : `Average ${flow.lead.avg} d, created → done`} />
            <Metric icon={Gauge} label="Throughput" value={`${flow.finished.length}`} detail={`Finished in the last ${flow.days} days`} />
            <Metric icon={Activity} label="Work in progress" value={`${flow.wip}`} detail="Started, not finished" />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Cumulative flow"
              subtitle="Tasks in each status at the end of every day. Widening bands mean work is piling up."
              legend={flow.columns.map((c, i) => ({ label: c.title, color: colorOf(i) })).reverse()}
              table={<DataTable head={["Day", ...flow.columns.map((c) => c.title)]} rows={flow.cfd.map((d) => [formatShort(d.day), ...flow.columns.map((c) => d.counts[c.id] ?? 0)])} />}
              className="xl:col-span-2"
            >
              {(setTip) => <Cfd flow={flow} colorOf={colorOf} setTip={setTip} />}
            </ChartCard>
            <ChartCard
              title="Cycle time"
              subtitle="Each dot is a finished task: when it was done and how many days it took from start."
              legend={[{ label: "50th percentile", color: "#7b68ee" }, { label: "85th percentile", color: "#dd6b00" }]}
              table={<DataTable head={["Task", "Done", "Cycle (days)", "Lead (days)"]} rows={flow.finished.map((f) => [f.ref, formatShort(f.doneAt.slice(0, 10)), f.cycleDays === null ? "—" : f.cycleDays.toFixed(1), f.leadDays.toFixed(1)])} />}
            >
              {(setTip) => <Scatter flow={flow} setTip={setTip} />}
            </ChartCard>
            <ChartCard
              title="Throughput"
              subtitle="Tasks finished per week"
              table={<DataTable head={["Week of", "Finished"]} rows={flow.throughput.map((w) => [formatShort(w.week), w.count])} />}
            >
              {(setTip) => <Bars weeks={flow.throughput} setTip={setTip} />}
            </ChartCard>
          </div>
        </>
      )}
    </section>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-card">
      <div className="flex items-center gap-2 text-[13.5px] font-medium text-muted"><Icon className="h-4 w-4" /> {label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-[13px] text-subtle">{detail}</div>
    </div>
  );
}

const axisY = (max: number) => {
  const step = max <= 5 ? 1 : max <= 20 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  return ticks;
};

function Cfd({ flow, colorOf, setTip }: { flow: Flow; colorOf: (i: number) => string; setTip: (t: Tip) => void }) {
  const n = flow.cfd.length;
  const totals = flow.cfd.map((d) => flow.columns.reduce((s, c) => s + (d.counts[c.id] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const x = (i: number) => PAD.l + (i / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  // Stack from the last status (Done) at the bottom upwards, Azure-style.
  const order = flow.columns.map((c, i) => ({ c, i })).reverse();
  const bands = order.map(({ c, i }, k) => {
    const below = (d: (typeof flow.cfd)[number]) => order.slice(0, k).reduce((s, o) => s + (d.counts[o.c.id] ?? 0), 0);
    const top = flow.cfd.map((d, j) => `${x(j)},${y(below(d) + (d.counts[c.id] ?? 0))}`);
    const bottom = flow.cfd.map((d, j) => `${x(j)},${y(below(d))}`).reverse();
    return { key: c.id, color: colorOf(i), points: [...top, ...bottom].join(" ") };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Cumulative flow diagram">
      {axisY(max).map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#eceef2" />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#8a909b">{v}</text>
        </g>
      ))}
      {bands.map((b) => <polygon key={b.key} points={b.points} fill={b.color} fillOpacity={0.78} stroke="white" strokeWidth={0.5} />)}
      {flow.cfd.map((d, j) => (j % Math.ceil(n / 6) === 0 || j === n - 1) && (
        <text key={d.day} x={x(j)} y={H - 6} textAnchor="middle" fontSize="10" fill="#8a909b">{formatShort(d.day)}</text>
      ))}
      {flow.cfd.map((d, j) => (
        <rect key={`hit-${d.day}`} x={x(j) - (W - PAD.l) / n / 2} y={PAD.t} width={(W - PAD.l) / n} height={H - PAD.t - PAD.b} fill="transparent"
          onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, lines: (
            <div>
              <div className="mb-1 font-semibold">{formatShort(d.day)}</div>
              {flow.columns.map((c) => <div key={c.id} className="flex justify-between gap-4"><span>{c.title}</span><b className="tabular-nums">{d.counts[c.id] ?? 0}</b></div>)}
            </div>
          ) })}
        />
      ))}
    </svg>
  );
}

function Scatter({ flow, setTip }: { flow: Flow; setTip: (t: Tip) => void }) {
  const pts = flow.finished.filter((f) => f.cycleDays !== null);
  if (!pts.length) return <p className="py-10 text-center text-[14px] text-subtle">No finished work in this period yet.</p>;
  const max = Math.max(1, ...pts.map((p) => p.cycleDays!), flow.cycle.p85 ?? 0) * 1.1;
  const t0 = +new Date(flow.cfd[0]!.day), t1 = +new Date(flow.cfd[flow.cfd.length - 1]!.day) + 86_400_000;
  const x = (iso: string) => PAD.l + ((+new Date(iso) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const line = (v: number | null, color: string, label: string) => v === null ? null : (
    <g>
      <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={color} strokeDasharray="5 4" strokeWidth={1.5} />
      <text x={W - PAD.r - 2} y={y(v) - 4} textAnchor="end" fontSize="10" fill={color}>{label} {v} d</text>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Cycle time scatter">
      {axisY(Math.ceil(max)).map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#eceef2" />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#8a909b">{v}</text>
        </g>
      ))}
      {line(flow.cycle.p50, "#7b68ee", "50%")}
      {line(flow.cycle.p85, "#dd6b00", "85%")}
      {pts.map((p) => (
        <circle key={p.id} cx={x(p.doneAt)} cy={y(p.cycleDays!)} r={5} fill="#0f9d74" fillOpacity={0.75} stroke="white"
          onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, lines: <div><b>{p.ref}</b> {p.title}<div>Cycle {p.cycleDays!.toFixed(1)} d · lead {p.leadDays.toFixed(1)} d</div></div> })} />
      ))}
    </svg>
  );
}

function Bars({ weeks, setTip }: { weeks: { week: string; count: number }[]; setTip: (t: Tip) => void }) {
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const bw = (W - PAD.l - PAD.r) / Math.max(1, weeks.length);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Weekly throughput">
      {axisY(max).map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="#eceef2" />
          <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#8a909b">{v}</text>
        </g>
      ))}
      {weeks.map((w, i) => (
        <g key={w.week} onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, lines: <div>Week of {formatShort(w.week)}: <b>{w.count}</b> finished</div> })}>
          <rect x={PAD.l + i * bw + bw * 0.18} y={y(w.count)} width={bw * 0.64} height={H - PAD.b - y(w.count)} rx={3} fill="#7b68ee" />
          <text x={PAD.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#8a909b">{formatShort(w.week)}</text>
        </g>
      ))}
    </svg>
  );
}
