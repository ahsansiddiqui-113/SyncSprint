"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Gauge } from "lucide-react";
import { sprintCapacityAction } from "@/actions/automation.actions";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type Data = Extract<Awaited<ReturnType<typeof sprintCapacityAction>>, { ok: true }>;

const TONE = {
  over: { bar: "bg-rose-500", text: "text-rose-700", label: "Over" },
  near: { bar: "bg-amber-500", text: "text-amber-700", label: "Near" },
  ok: { bar: "bg-primary", text: "text-muted", label: "OK" },
  idle: { bar: "bg-border-strong", text: "text-subtle", label: "Free" },
} as const;

/**
 * Capacity for one sprint (Azure Boards style): hours each person has in the sprint
 * vs the open, estimated work assigned to them. Refreshes when the sprint's tasks change.
 */
export function SprintCapacity({ organizationId, sprintId, signature, defaultOpen = false }: { organizationId: string; sprintId: string; signature: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    sprintCapacityAction(organizationId, sprintId).then((r) => (r.ok ? (setData(r), setError(null)) : setError(r.message)));
  }, [open, organizationId, sprintId, signature]);

  const t = data?.totals;
  const tone = t ? TONE[t.status] : TONE.idle;
  return (
    <div className="border-b border-border px-5 py-3">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full cursor-pointer items-center gap-2 text-left text-[14.5px]" aria-expanded={open}>
        <Gauge className="h-4 w-4 text-subtle" />
        <span className="font-semibold">Capacity</span>
        {t && (
          <span className={cn("text-[14px]", tone.text)}>
            {t.committed}h planned of {t.available}h available
            {t.status === "over" && " · over capacity"}
          </span>
        )}
        <ChevronDown className={cn("ml-auto h-4 w-4 text-subtle transition", open && "rotate-180")} />
      </button>
      {open && error && <p className="mt-2 text-[14px] text-subtle">{error}</p>}
      {open && data && (
        <div className="mt-3 animate-fade-up">
          <table className="w-full text-[14px]">
            <caption className="sr-only">Hours available vs planned per person in this sprint</caption>
            <thead className="text-left text-[12.5px] uppercase tracking-wide text-subtle">
              <tr>
                <th className="py-1.5 font-semibold">Person</th>
                <th className="w-[40%] py-1.5 font-semibold">Planned vs available</th>
                <th className="py-1.5 text-right font-semibold">Planned</th>
                <th className="py-1.5 text-right font-semibold">Available</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => {
                const pt = TONE[p.status];
                const pct = p.availableHours ? Math.min(100, (p.committedHours / p.availableHours) * 100) : p.committedHours ? 100 : 0;
                return (
                  <tr key={p.userId} className="border-t border-border">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <Avatar id={p.userId} name={p.name} src={p.avatarUrl} size={22} />
                        <span className="truncate">{p.name}</span>
                      </span>
                      {p.unestimated > 0 && <span className="ml-8 block text-[12.5px] text-subtle">{p.unestimated} task{p.unestimated === 1 ? "" : "s"} without an estimate</span>}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <div className={cn("h-full rounded-full", pt.bar)} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={cn("w-12 text-right text-[12.5px] font-medium", pt.text)}>
                          {p.status === "over" && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}
                          {pt.label}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{p.committedHours}h</td>
                    <td className="py-2 text-right tabular-nums">{p.availableHours}h</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.totals.unassigned > 0 && (
            <p className="mt-2 text-[13.5px] text-muted">
              {data.totals.unassigned === 1 ? `1 unassigned task (${data.totals.unassignedHours}h) isn’t` : `${data.totals.unassigned} unassigned tasks (${data.totals.unassignedHours}h) aren’t`} counted against anyone yet.
            </p>
          )}
          <p className="mt-1 text-[12.5px] text-subtle">From each person's working hours, time off and holidays over the sprint dates. Planning beyond capacity is allowed; it's flagged, not blocked.</p>
        </div>
      )}
    </div>
  );
}
