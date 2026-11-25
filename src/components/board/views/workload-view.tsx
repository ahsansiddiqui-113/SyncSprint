"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarOff, CheckCircle2, ChevronLeft, ChevronRight, Clock, Palmtree, Settings2, Trash2, Users } from "lucide-react";
import type { CapacitySettings, CapacityStatus, DayCell, PersonWorkload } from "@/server/services/capacity";
import { addTimeOffAction, deleteTimeOffAction, getWorkloadAction, setMemberCapacityAction, setWorkScheduleAction } from "@/actions/capacity.actions";
import { addDays, formatShort, formatWeekday, startOfWeek, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Sheet } from "../sheet";
import type { Member } from "../kanban-board";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type TimeOffRow = { id: string; userId: string | null; kind: "vacation" | "sick" | "holiday" | "other"; startDate: string; endDate: string; note: string | null };
type Data = { settings: CapacitySettings; people: PersonWorkload[]; timeOff: TimeOffRow[] };

/** Status visuals: always icon + text + color (never color alone). */
export const STATUS_UI: Record<CapacityStatus, { label: string; bar: string; chip: string; icon: typeof CheckCircle2 }> = {
  idle: { label: "Free", bar: "bg-border-strong", chip: "border-border bg-surface-2 text-muted", icon: Clock },
  ok: { label: "On track", bar: "bg-[#0f9d74]", chip: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  near: { label: "Near capacity", bar: "bg-[#dd6b00]", chip: "border-amber-200 bg-amber-50 text-amber-700", icon: AlertTriangle },
  over: { label: "Over capacity", bar: "bg-[#dc2626]", chip: "border-red-200 bg-red-50 text-red-600", icon: AlertTriangle },
};
const OFF_LABEL = { vacation: "Vacation", sick: "Sick", holiday: "Holiday", other: "Time off" } as const;

function cellStatus(c: DayCell, near: number): CapacityStatus {
  if (c.load <= 0) return "idle";
  if (c.capacity <= 0 || c.load > c.capacity + 1e-9) return "over";
  if (c.load >= (c.capacity * near) / 100) return "near";
  return "ok";
}
const h = (n: number) => `${Math.round(n * 10) / 10}h`;

export function WorkloadView({
  organizationId,
  members,
  canManage,
  refreshKey,
  projectTaskIds,
  onOpen,
}: {
  organizationId: string;
  members: Member[];
  canManage: boolean;
  refreshKey: number;
  projectTaskIds: Set<string>;
  onOpen: (taskId: string) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayISO()));
  const [span, setSpan] = useState<7 | 14>(14);
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<PersonWorkload | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showTimeOff, setShowTimeOff] = useState(false);
  const from = weekStart;
  const to = addDays(weekStart, span - 1);
  const today = todayISO();

  useEffect(() => {
    let alive = true;
    const id = setTimeout(async () => {
      const r = await getWorkloadAction(organizationId, from, to, todayISO());
      if (!alive) return;
      if (r.ok) setData({ settings: r.settings, people: r.people, timeOff: r.timeOff });
      else toast.error(r.message);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [organizationId, from, to, refreshKey]);

  const days = useMemo(() => Array.from({ length: span }, (_, i) => addDays(from, i)), [from, span]);
  const people = useMemo(() => {
    const rank: Record<CapacityStatus, number> = { over: 0, near: 1, ok: 2, idle: 3 };
    return [...(data?.people ?? [])].sort((a, b) => rank[a.status] - rank[b.status] || b.totalLoad - a.totalLoad || a.name.localeCompare(b.name));
  }, [data]);
  const overCount = people.filter((p) => p.status === "over").length;
  const nearCount = people.filter((p) => p.status === "near").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-white px-8 py-3">
        <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(today))}>This week</Button>
        <Button variant="ghost" size="icon" aria-label="Previous week" onClick={() => setWeekStart((w) => addDays(w, -7))}><ChevronLeft className="h-5 w-5" /></Button>
        <Button variant="ghost" size="icon" aria-label="Next week" onClick={() => setWeekStart((w) => addDays(w, 7))}><ChevronRight className="h-5 w-5" /></Button>
        <h2 className="ml-1 text-lg font-bold tracking-tight">{formatShort(from)} – {formatShort(to)}</h2>
        <div className="ml-2 flex rounded-lg border border-border bg-surface-2 p-0.5">
          {([7, 14] as const).map((n) => (
            <button key={n} onClick={() => setSpan(n)} className={cn("cursor-pointer rounded-md px-3 py-1 text-[14px] font-medium", span === n ? "bg-white shadow-card" : "text-muted")}>
              {n === 7 ? "1 week" : "2 weeks"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {overCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[13px] font-semibold text-red-600">
              <AlertTriangle className="h-4 w-4" /> {overCount} over capacity
            </span>
          )}
          {nearCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[13px] font-semibold text-amber-700">
              <AlertTriangle className="h-4 w-4" /> {nearCount} near capacity
            </span>
          )}
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowTimeOff(true)}><Palmtree className="h-4 w-4" /> Time off</Button>
              <Button variant="outline" size="sm" onClick={() => setShowSchedule(true)}><Settings2 className="h-4 w-4" /> Work schedule</Button>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-8 py-5">
        <p className="mb-3 text-[14px] text-muted">
          Hours from time estimates, spread across each person&apos;s working days and split between assignees. Counts open work in every project of this workspace.
          {canManage ? " Click someone's weekly hours to change their capacity." : ""}
        </p>
        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-card">
          <div className="grid" style={{ gridTemplateColumns: `280px repeat(${span}, minmax(78px, 1fr))` }}>
            {/* header */}
            <div className="sticky left-0 z-10 flex items-center gap-2 border-b border-r border-border bg-surface-2 px-4 py-2.5 text-[13px] font-semibold uppercase tracking-wide text-subtle">
              <Users className="h-4 w-4" /> Person
            </div>
            {days.map((d) => (
              <div key={d} className={cn("border-b border-l border-border px-2 py-2 text-center text-[12.5px]", d === today ? "bg-primary-soft font-bold text-primary" : "bg-surface-2 text-subtle")}>
                <div className="font-semibold uppercase">{formatWeekday(d)}</div>
                <div>{formatShort(d)}</div>
              </div>
            ))}

            {!data && Array.from({ length: Math.max(2, members.length) }).map((_, i) => (
              <div key={i} className="col-span-full h-16 animate-pulse border-b border-border bg-surface-2/40" />
            ))}

            {people.map((p) => {
              const S = STATUS_UI[p.status];
              return (
                <Row key={p.userId}>
                  <div className="sticky left-0 z-10 flex items-center gap-3 border-b border-r border-border bg-white px-4 py-3">
                    <Avatar id={p.userId} name={p.name} src={p.avatarUrl} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold">{p.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] font-semibold", S.chip)}>
                          <S.icon className="h-3.5 w-3.5" /> {S.label}
                        </span>
                        <button
                          disabled={!canManage}
                          onClick={() => setEditing(p)}
                          title={canManage ? "Change capacity" : undefined}
                          className={cn("text-[13px] tabular-nums text-muted", canManage && "cursor-pointer underline decoration-dotted underline-offset-2 hover:text-primary")}
                        >
                          {h(p.totalLoad)} / {h(p.totalCapacity)}
                        </button>
                        {p.customized && <span className="text-[12px] text-subtle">custom hours</span>}
                      </div>
                      {(p.unestimated > 0 || p.unscheduled > 0) && (
                        <div className="mt-1 text-[12px] text-subtle">
                          {p.unestimated > 0 && <span>{p.unestimated} unestimated</span>}
                          {p.unestimated > 0 && p.unscheduled > 0 && " · "}
                          {p.unscheduled > 0 && <span>{p.unscheduled} undated</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  {p.days.map((c) => (
                    <Cell key={c.day} cell={c} near={data!.settings.nearThreshold} today={c.day === today} projectTaskIds={projectTaskIds} onOpen={onOpen} />
                  ))}
                </Row>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted">
          {(["ok", "near", "over"] as const).map((s) => {
            const S = STATUS_UI[s];
            return (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2.5 w-5 rounded-sm", S.bar)} /> {S.label}
                {s === "near" && data ? ` (≥ ${data.settings.nearThreshold}%)` : ""}
              </span>
            );
          })}
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-[repeating-linear-gradient(45deg,#e8eaed,#e8eaed_3px,#f7f8fa_3px,#f7f8fa_6px)]" /> Day off</span>
        </div>
      </div>

      {editing && data && <CapacityDialog organizationId={organizationId} person={editing} defaults={data.settings.defaultHours} onClose={() => setEditing(null)} />}
      {showSchedule && data && <ScheduleDialog organizationId={organizationId} settings={data.settings} onClose={() => setShowSchedule(false)} />}
      {showTimeOff && data && <TimeOffDialog organizationId={organizationId} members={members} rows={data.timeOff} onClose={() => setShowTimeOff(false)} />}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="contents">{children}</div>;
}

function Cell({ cell, near, today, projectTaskIds, onOpen }: { cell: DayCell; near: number; today: boolean; projectTaskIds: Set<string>; onOpen: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  const s = cellStatus(cell, near);
  const S = STATUS_UI[s];
  const pct = cell.capacity > 0 ? Math.min(100, (cell.load / cell.capacity) * 100) : cell.load > 0 ? 100 : 0;
  const off = cell.off;
  return (
    <div
      className={cn(
        "relative border-b border-l border-border px-2 py-2",
        off && "bg-[repeating-linear-gradient(45deg,#f1f2f4,#f1f2f4_4px,#f8f9fa_4px,#f8f9fa_8px)]",
        !off && cell.capacity === 0 && "bg-surface-2/60",
        today && "ring-1 ring-inset ring-primary/30"
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {off ? (
        <div className="flex h-full flex-col items-center justify-center gap-0.5 text-[12px] font-medium text-subtle">
          <CalendarOff className="h-3.5 w-3.5" /> {OFF_LABEL[off]}
          {cell.load > 0 && <span className="font-semibold text-red-600">{h(cell.load)} planned</span>}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-1 text-[12.5px] tabular-nums">
            <span className={cn("font-semibold", s === "over" ? "text-red-600" : "text-foreground")}>{cell.load > 0 ? h(cell.load) : "—"}</span>
            <span className="text-subtle">{cell.capacity > 0 ? h(cell.capacity) : "off"}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className={cn("h-full rounded-full", S.bar)} style={{ width: `${pct}%` }} />
          </div>
          {s === "over" && (
            <div className="mt-1 flex items-center gap-1 text-[11.5px] font-semibold text-red-600">
              <AlertTriangle className="h-3 w-3" /> +{h(cell.load - cell.capacity)}
            </div>
          )}
        </>
      )}
      {hover && cell.items.length > 0 && (
        <div role="tooltip" className="absolute left-1/2 top-full z-30 mt-1 w-72 -translate-x-1/2 rounded-xl border border-border bg-white p-3 text-[13px] shadow-lift">
          <div className="mb-1.5 flex items-center justify-between font-semibold">
            <span>{formatWeekday(cell.day)} {formatShort(cell.day)}</span>
            <span className={cn(s === "over" ? "text-red-600" : "text-muted")}>{h(cell.load)} of {h(cell.capacity)}</span>
          </div>
          <ul className="space-y-1">
            {cell.items.map((it) => (
              <li key={it.taskId} className="flex items-center gap-2">
                <button
                  disabled={!projectTaskIds.has(it.taskId)}
                  onClick={() => onOpen(it.taskId)}
                  className="min-w-0 flex-1 cursor-pointer truncate text-left hover:text-primary disabled:cursor-default disabled:hover:text-foreground"
                  title={projectTaskIds.has(it.taskId) ? "Open task" : `In project ${it.projectKey}`}
                >
                  <span className="text-subtle">{it.ref}</span> {it.title}
                </button>
                {it.overdue && <span className="rounded bg-red-50 px-1 text-[11px] font-semibold text-red-600">overdue</span>}
                <span className="tabular-nums text-muted">{h(it.hours)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- dialogs --------------------------------- */

function HoursGrid({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {WEEKDAYS.map((d, i) => (
        <div key={d} className="space-y-1">
          <Label htmlFor={`h-${d}`} className="block text-center">{d}</Label>
          <Input
            id={`h-${d}`}
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={value[i]}
            onChange={(e) => {
              const next = [...value];
              next[i] = Math.max(0, Math.min(24, Number(e.target.value) || 0));
              onChange(next);
            }}
            className="px-1 text-center"
          />
        </div>
      ))}
    </div>
  );
}

function CapacityDialog({ organizationId, person, defaults, onClose }: { organizationId: string; person: PersonWorkload; defaults: number[]; onClose: () => void }) {
  const [hours, setHours] = useState<number[]>([...person.hours]);
  const [pending, start] = useTransition();
  const weekly = hours.reduce((a, b) => a + b, 0);
  const save = (value: number[] | null) =>
    start(async () => {
      const r = await setMemberCapacityAction(organizationId, person.userId, value);
      if (!r.ok) return void toast.error(r.message);
      toast.success(value ? `${person.name}: ${weekly}h per week` : `${person.name} uses the workspace schedule`);
      onClose();
    });
  return (
    <Sheet side="center" title={`Capacity · ${person.name}`} onClose={onClose}>
      <p className="mb-4 text-[15px] text-muted">Working hours per day. Days set to 0 are days off. This overrides the workspace schedule for {person.name.split(" ")[0]}.</p>
      <HoursGrid value={hours} onChange={setHours} />
      <p className="mt-3 text-[15px]"><b>{weekly}h</b> per week</p>
      <div className="mt-5 flex justify-between gap-2">
        <Button variant="ghost" disabled={pending || !person.customized} onClick={() => save(null)}>Reset to workspace default ({defaults.reduce((a, b) => a + b, 0)}h)</Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || weekly === 0} onClick={() => save(hours)}>Save</Button>
        </div>
      </div>
    </Sheet>
  );
}

function ScheduleDialog({ organizationId, settings, onClose }: { organizationId: string; settings: CapacitySettings; onClose: () => void }) {
  const [hours, setHours] = useState<number[]>([...settings.defaultHours]);
  const [near, setNear] = useState(settings.nearThreshold);
  const [pending, start] = useTransition();
  const weekly = hours.reduce((a, b) => a + b, 0);
  return (
    <Sheet side="center" title="Workspace work schedule" onClose={onClose}>
      <p className="mb-4 text-[15px] text-muted">Default working hours for everyone without a personal schedule.</p>
      <HoursGrid value={hours} onChange={setHours} />
      <p className="mt-3 text-[15px]"><b>{weekly}h</b> per week</p>
      <div className="mt-5 space-y-1.5">
        <Label htmlFor="near">Warn when someone reaches this share of their capacity</Label>
        <div className="flex items-center gap-3">
          <input id="near" type="range" min={50} max={100} step={5} value={near} onChange={(e) => setNear(Number(e.target.value))} className="flex-1 accent-[#7b68ee]" />
          <span className="w-12 text-right font-semibold tabular-nums">{near}%</span>
        </div>
        <p className="text-[13px] text-subtle">Above 100% is always shown as over capacity. Assignments are never blocked.</p>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          disabled={pending || weekly === 0}
          onClick={() =>
            start(async () => {
              const r = await setWorkScheduleAction(organizationId, hours, near);
              if (!r.ok) return void toast.error(r.message);
              toast.success("Work schedule updated");
              onClose();
            })
          }
        >
          Save schedule
        </Button>
      </div>
    </Sheet>
  );
}

function TimeOffDialog({ organizationId, members, rows, onClose }: { organizationId: string; members: Member[]; rows: TimeOffRow[]; onClose: () => void }) {
  const today = todayISO();
  const [who, setWho] = useState(members[0]?.id ?? "__all");
  const [kind, setKind] = useState<TimeOffRow["kind"]>("vacation");
  const [startDate, setStart] = useState(today);
  const [endDate, setEnd] = useState(today);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const invalid = startDate > endDate;
  const name = (id: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? "Former member") : "Everyone (holiday)");

  return (
    <Sheet side="center" title="Time off & holidays" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          start(async () => {
            const r = await addTimeOffAction(organizationId, { userId: who === "__all" ? null : who, kind: who === "__all" ? "holiday" : kind, startDate, endDate, note: note || null });
            if (!r.ok) return void toast.error(r.message);
            toast.success("Time off added — capacity updated");
            onClose();
          });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="to-who">Who</Label>
            <Select id="to-who" value={who} onChange={(e) => setWho(e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              <option value="__all">Everyone (workspace holiday)</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to-kind">Type</Label>
            <Select id="to-kind" value={who === "__all" ? "holiday" : kind} disabled={who === "__all"} onChange={(e) => setKind(e.target.value as TimeOffRow["kind"])}>
              <option value="vacation">Vacation</option>
              <option value="sick">Sick</option>
              <option value="other">Other</option>
              <option value="holiday">Holiday</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to-start">From</Label>
            <Input id="to-start" type="date" value={startDate} max={endDate} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to-end">To</Label>
            <Input id="to-end" type="date" value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to-note">Note (optional)</Label>
          <Input id="to-note" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Eid holidays" />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          <Button disabled={pending || invalid}>Add time off</Button>
        </div>
      </form>

      <div className="mt-6">
        <h3 className="mb-2 text-[14px] font-semibold text-subtle">In this period</h3>
        {rows.length === 0 && <p className="text-[14px] text-subtle">No time off in the visible weeks.</p>}
        <div className="divide-y divide-border rounded-lg border border-border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-[14px]">
              <Palmtree className="h-4 w-4 text-subtle" />
              <span className="font-medium">{name(r.userId)}</span>
              <span className="text-muted">{OFF_LABEL[r.kind]} · {formatShort(r.startDate)}{r.endDate !== r.startDate ? ` – ${formatShort(r.endDate)}` : ""}</span>
              {r.note && <span className="truncate text-subtle">· {r.note}</span>}
              <button
                className="ml-auto cursor-pointer rounded p-1 text-subtle hover:text-red-600"
                aria-label="Remove time off"
                onClick={() =>
                  start(async () => {
                    const res = await deleteTimeOffAction(organizationId, r.id);
                    if (!res.ok) return void toast.error(res.message);
                    toast.success("Time off removed");
                    onClose();
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
