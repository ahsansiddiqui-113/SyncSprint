"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { CalendarRange, Loader2, MessageSquarePlus, Rocket } from "lucide-react";
import type { ProjectStatus } from "@/db/schema";
import { getPortfolioAction, setProjectStatusAction } from "@/actions/planning.actions";
import { useSignal, useVisiblePoll } from "@/components/workspace/signals";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatShort, todayISO } from "@/lib/dates";
import { cn, timeAgo } from "@/lib/utils";

type Portfolio = Awaited<ReturnType<typeof import("@/server/services/portfolio").getPortfolio>>;
type Row = Portfolio["projects"][number];

const HEALTH: Record<Row["health"], { label: string; cls: string; dot: string }> = {
  on_track: { label: "On track", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", dot: "bg-emerald-500" },
  at_risk: { label: "At risk", cls: "bg-amber-50 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  late: { label: "Late", cls: "bg-rose-50 text-rose-800 border-rose-200", dot: "bg-rose-500" },
  done: { label: "Done", cls: "bg-indigo-50 text-indigo-800 border-indigo-200", dot: "bg-indigo-500" },
  not_started: { label: "Not scheduled", cls: "bg-slate-50 text-slate-700 border-slate-200", dot: "bg-slate-400" },
};
const STATUS: Record<ProjectStatus, { label: string; cls: string }> = {
  on_track: { label: "On track", cls: "text-emerald-700" },
  at_risk: { label: "At risk", cls: "text-amber-700" },
  off_track: { label: "Off track", cls: "text-rose-700" },
  on_hold: { label: "On hold", cls: "text-slate-600" },
  complete: { label: "Complete", cls: "text-indigo-700" },
};

export function PortfolioBoard({ org, canPost, initial }: { org: { id: string; slug: string }; canPost: boolean; initial: Portfolio }) {
  const [data, setData] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await getPortfolioAction(org.id, todayISO());
    if (r.ok) setData({ today: r.today, projects: r.projects });
  }, [org.id]);
  useVisiblePoll(reload, 60_000);
  useSignal((e) => (e.type === "PLANNING_CHANGED" || e.type === "TASK_CREATED" || e.type === "TASK_UPDATED" || e.type === "TASK_DELETED") && void reload());

  const counts = data.projects.reduce<Record<string, number>>((m, p) => ({ ...m, [p.health]: (m[p.health] ?? 0) + 1 }), {});

  if (!data.projects.length) {
    return <Card className="p-10 text-center text-[15px] text-muted">No projects yet. Create one from Home and it will show up here.</Card>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {(Object.keys(HEALTH) as Row["health"][]).map((h) => (
          <Card key={h} className="px-4 py-3">
            <div className="flex items-center gap-2 text-[13.5px] font-medium text-muted">
              <span className={cn("h-2.5 w-2.5 rounded-full", HEALTH[h].dot)} /> {HEALTH[h].label}
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{counts[h] ?? 0}</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-[14.5px]">
          <thead className="border-b border-border text-[12.5px] font-semibold uppercase tracking-wide text-subtle">
            <tr>
              <th className="px-5 py-3">Project</th>
              <th className="px-3 py-3">Health</th>
              <th className="px-3 py-3">Progress</th>
              <th className="px-3 py-3 text-right">Open</th>
              <th className="px-3 py-3 text-right">Overdue</th>
              <th className="px-3 py-3">Dates</th>
              <th className="px-3 py-3">Sprint</th>
              <th className="px-5 py-3">Latest update</th>
            </tr>
          </thead>
          <tbody>
            {data.projects.map((p) => (
              <tr key={p.id} className="border-b border-border/70 align-top last:border-0">
                <td className="px-5 py-3.5">
                  <Link href={`/w/${org.slug}/projects/${p.key}`} className="group flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-[12px] font-bold text-white">{p.key.slice(0, 2)}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold group-hover:text-primary group-hover:underline">{p.name}</span>
                      <span className="text-[12.5px] text-subtle">{p.key} · {p.total} task{p.total === 1 ? "" : "s"}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3.5">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold", HEALTH[p.health].cls)}>
                    <span className={cn("h-2 w-2 rounded-full", HEALTH[p.health].dot)} />
                    {HEALTH[p.health].label}
                  </span>
                </td>
                <td className="px-3 py-3.5">
                  <Progress value={p.progress} expected={p.expected} />
                  <div className="mt-1 text-[12.5px] text-subtle">
                    {Math.round(p.progress * 100)}% done{p.expected !== null && p.health !== "done" ? ` · ${Math.round(p.expected * 100)}% of time used` : ""}
                    {p.points ? ` · ${p.pointsDone}/${p.points} pts` : ""}
                  </div>
                </td>
                <td className="px-3 py-3.5 text-right tabular-nums">{p.open}</td>
                <td className={cn("px-3 py-3.5 text-right tabular-nums", p.overdue > 0 && "font-semibold text-rose-700")}>{p.overdue}</td>
                <td className="px-3 py-3.5 text-[13.5px] text-muted">
                  {p.start || p.end ? (
                    <span className="inline-flex items-center gap-1.5"><CalendarRange className="h-3.5 w-3.5" />{p.start ? formatShort(p.start) : "?"} – {p.end ? formatShort(p.end) : "?"}</span>
                  ) : "—"}
                </td>
                <td className="px-3 py-3.5 text-[13.5px]">
                  {p.sprint ? (
                    <span className="inline-flex items-center gap-1.5"><Rocket className="h-3.5 w-3.5 text-primary" />{p.sprint.name}{p.sprint.endDate && <span className="text-subtle">· ends {formatShort(p.sprint.endDate)}</span>}</span>
                  ) : <span className="text-subtle">—</span>}
                </td>
                <td className="max-w-[340px] px-5 py-3.5">
                  {editing === p.id ? (
                    <StatusForm
                      initial={p.status}
                      onCancel={() => setEditing(null)}
                      onSave={async (status, note) => {
                        const r = await setProjectStatusAction(org.id, p.id, status, note);
                        if (!r.ok) return void toast.error(r.message);
                        toast.success("Status posted");
                        setEditing(null);
                        await reload();
                      }}
                    />
                  ) : (
                    <div className="space-y-1">
                      {p.status ? (
                        <>
                          <div className={cn("text-[13.5px] font-semibold", STATUS[p.status.value].cls)}>{STATUS[p.status.value].label}</div>
                          {p.status.note && <p className="line-clamp-3 text-[13.5px] text-foreground/80">{p.status.note}</p>}
                          <div className="text-[12px] text-subtle">{p.status.by ?? "Someone"}{p.status.at ? ` · ${timeAgo(p.status.at)}` : ""}</div>
                        </>
                      ) : (
                        <div className="text-[13.5px] text-subtle">No update yet</div>
                      )}
                      {canPost && (
                        <button onClick={() => setEditing(p.id)} className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-primary hover:underline">
                          <MessageSquarePlus className="h-3.5 w-3.5" /> Post update
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-[13px] text-subtle">
        Health is worked out from the tasks: <b>late</b> when the last due date has passed with work open, <b>at risk</b> with overdue tasks or progress more than 20 points behind the time used.
        Status updates are written by admins.
      </p>
    </div>
  );
}

function Progress({ value, expected }: { value: number; expected: number | null }) {
  return (
    <div className="relative h-2 w-44 overflow-visible rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(value * 100)}%` }} />
      {expected !== null && (
        <div className="absolute -top-1 h-4 w-0.5 bg-foreground/60" style={{ left: `calc(${Math.round(expected * 100)}% - 1px)` }} title={`Expected by now: ${Math.round(expected * 100)}%`} />
      )}
    </div>
  );
}

function StatusForm({ initial, onSave, onCancel }: { initial: Row["status"]; onSave: (s: ProjectStatus, note: string | null) => Promise<void>; onCancel: () => void }) {
  const [status, setStatus] = useState<ProjectStatus>(initial?.value ?? "on_track");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSave(status, note.trim() || null);
        setBusy(false);
      }}
    >
      <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} className="h-9 w-full rounded-lg border border-border bg-white px-2 text-[14px]">
        {(Object.keys(STATUS) as ProjectStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
      </select>
      <textarea aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder="What changed, what's blocking, what's next…" className="w-full rounded-lg border border-border bg-white px-2.5 py-2 text-[14px]" />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Post</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
