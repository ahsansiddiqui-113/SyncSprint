"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, ChevronDown, Pencil, Play, Plus, Rocket, Target, Trash2 } from "lucide-react";
import type { TaskDTO } from "@/lib/realtime-protocol";
import { diffDays, formatShort, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { SprintDTO, SprintReport } from "@/server/services/sprints";
import {
  completeSprintAction,
  createSprintAction,
  deleteSprintAction,
  sprintReportAction,
  startSprintAction,
  updateSprintAction,
  velocityAction,
} from "@/actions/sprint.actions";
import { Avatar } from "@/components/ui/avatar";
import { PriorityFlag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Sheet } from "../sheet";
import { BreakdownBadges, PointsBadge, TypeIcon } from "../task-meta";
import {
  ChartFrame,
  COMPLETED_COLOR,
  IDEAL_COLOR,
  LineChart,
  REMAINING_COLOR,
  SCOPE_COLOR,
  SimpleTable,
  VelocityChart,
} from "./sprint-charts";
import type { TaskPatch, ViewProps } from "./types";

type Props = ViewProps & {
  organizationId: string;
  projectId: string;
  sprints: SprintDTO[];
  canManage: boolean;
  onPatch: (task: TaskDTO, patch: TaskPatch) => void;
};

const BACKLOG = "backlog";
const zoneOf = (sprintId: string | null) => (sprintId ? `sprint:${sprintId}` : BACKLOG);
const points = (ts: TaskDTO[]) => ts.reduce((s, t) => s + (t.storyPoints ?? 0), 0);

export function SprintsView(props: Props) {
  const { sprints } = props;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SprintDTO | "new" | null>(null);
  const [completing, setCompleting] = useState<SprintDTO | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [pending, start] = useTransition();

  const active = sprints.find((s) => s.status === "active") ?? null;
  const planned = sprints.filter((s) => s.status === "planned");
  const completed = sprints.filter((s) => s.status === "completed");

  const all = useMemo(() => Object.values(props.tasks).sort((a, b) => a.position - b.position), [props.tasks]);
  const isDone = (t: TaskDTO) => t.columnId === props.doneColumnId;
  const inSprint = (id: string) => all.filter((t) => t.sprintId === id);
  // Backlog = open work with no sprint (done-without-sprint isn't planning material).
  const backlog = all.filter((t) => !t.sprintId && !isDone(t));

  function onDragEnd({ active: a, over }: DragEndEvent) {
    setDragId(null);
    const task = props.tasks[String(a.id)];
    if (!task || !over) return;
    const zone = String(over.id);
    const target = zone === BACKLOG ? null : zone.slice("sprint:".length);
    if ((task.sprintId ?? null) === target) return;
    props.onPatch(task, { sprintId: target });
  }

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message ?? "Something went wrong");
      if (ok) toast.success(ok);
    });

  const dragTask = dragId ? props.tasks[dragId] : null;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-canvas">
      <DndContext id="sprints-dnd" sensors={sensors} onDragStart={(e) => setDragId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        <div className="min-w-0 flex-1 space-y-5 overflow-y-auto px-8 py-6">
          {/* active sprint */}
          {active ? (
            <ActiveSprintCard
              sprint={active}
              tasks={inSprint(active.id)}
              doneColumnId={props.doneColumnId}
              canManage={props.canManage}
              onEdit={() => setEditing(active)}
              onComplete={() => setCompleting(active)}
            >
              <TaskZone id={zoneOf(active.id)} tasks={inSprint(active.id)} props={props} empty="Drag tasks from the backlog to add them to this sprint." />
            </ActiveSprintCard>
          ) : (
            <div className="flex items-center gap-4 rounded-xl border-2 border-dashed border-border-strong bg-white/70 px-6 py-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary"><Rocket className="h-5 w-5" /></span>
              <div className="flex-1">
                <h2 className="text-[17px] font-semibold">No active sprint</h2>
                <p className="text-[14px] text-muted">
                  {planned.length ? "Start a planned sprint below when your team is ready." : "Create a sprint, fill it from the backlog, then start it."}
                </p>
              </div>
            </div>
          )}

          {/* planned sprints */}
          {planned.map((s) => {
            const ts = inSprint(s.id);
            return (
              <section key={s.id} className="rounded-xl border border-border bg-white shadow-card">
                <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
                  <h2 className="text-[17px] font-semibold">{s.name}</h2>
                  <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[12.5px] font-semibold text-muted">Planned</span>
                  <DateRange s={s} />
                  <span className="text-[14px] text-muted">{ts.length} tasks · {points(ts)} pts</span>
                  {props.canManage && (
                    <div className="ml-auto flex gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}><Pencil className="h-4 w-4" /></Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${s.name}`}
                        disabled={pending}
                        onClick={() => confirm(`Delete ${s.name}? Its tasks go back to the backlog.`) && run(() => deleteSprintAction(props.organizationId, s.id), `${s.name} deleted`)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button size="sm" disabled={pending || !!active} title={active ? `Complete ${active.name} first` : undefined} onClick={() => run(() => startSprintAction(props.organizationId, s.id), `${s.name} started`)}>
                        <Play className="h-4 w-4" /> Start sprint
                      </Button>
                    </div>
                  )}
                </header>
                {s.goal && <p className="flex items-center gap-2 px-5 pt-3 text-[14px] text-muted"><Target className="h-4 w-4" /> {s.goal}</p>}
                <TaskZone id={zoneOf(s.id)} tasks={ts} props={props} empty="Drag tasks here to plan this sprint." />
              </section>
            );
          })}

          {/* backlog */}
          <section className="rounded-xl border border-border bg-white shadow-card">
            <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5">
              <h2 className="text-[17px] font-semibold">Backlog</h2>
              <span className="text-[14px] text-muted">{backlog.length} tasks · {points(backlog)} pts</span>
              {props.canManage && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEditing("new")}>
                  <Plus className="h-4 w-4" /> Create sprint
                </Button>
              )}
            </header>
            <TaskZone id={BACKLOG} tasks={backlog} props={props} empty="The backlog is empty. Nice." />
          </section>

          {/* completed */}
          {completed.length > 0 && (
            <section>
              <button onClick={() => setShowCompleted((v) => !v)} className="flex cursor-pointer items-center gap-2 text-[15px] font-semibold text-muted hover:text-foreground">
                <ChevronDown className={cn("h-4 w-4 transition-transform", !showCompleted && "-rotate-90")} /> Completed sprints ({completed.length})
              </button>
              {showCompleted && (
                <div className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-white">
                  {completed.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[14px]">
                      <CheckCircle2 className="h-4 w-4 text-[#0f9d74]" />
                      <span className="font-medium">{s.name}</span>
                      <DateRange s={s} />
                      <span className="ml-auto text-muted">
                        {s.completedPoints ?? 0} of {s.committedPoints ?? 0} pts delivered
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragTask && (
            <div className="w-[560px] rotate-1">
              <TaskRowBody task={dragTask} props={props} className="shadow-glow" />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <ReportPanel organizationId={props.organizationId} projectId={props.projectId} sprints={sprints} tasks={all} />

      {editing && (
        <SprintDialog
          sprint={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            start(async () => {
              const r = editing === "new" ? await createSprintAction(props.organizationId, props.projectId, input) : await updateSprintAction(props.organizationId, editing.id, input);
              if (!r.ok) return void toast.error(r.message);
              toast.success(editing === "new" ? `${r.sprint.name} created` : "Sprint updated");
              setEditing(null);
            })
          }
          pending={pending}
        />
      )}
      {completing && (
        <CompleteDialog
          sprint={completing}
          open={inSprint(completing.id).filter((t) => !isDone(t))}
          planned={planned}
          onClose={() => setCompleting(null)}
          pending={pending}
          onConfirm={(moveTo) =>
            start(async () => {
              const r = await completeSprintAction(props.organizationId, completing.id, moveTo);
              if (!r.ok) return void toast.error(r.message);
              toast.success(`${completing.name} completed${r.moved ? ` · ${r.moved} unfinished task${r.moved === 1 ? "" : "s"} carried over` : ""}`);
              setCompleting(null);
            })
          }
        />
      )}
    </div>
  );
}

/* ---------------------------------- pieces --------------------------------- */

function DateRange({ s }: { s: SprintDTO }) {
  if (!s.startDate || !s.endDate) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[14px] text-muted">
      <CalendarDays className="h-4 w-4" /> {formatShort(s.startDate)} – {formatShort(s.endDate)}
    </span>
  );
}

function ActiveSprintCard({
  sprint,
  tasks,
  doneColumnId,
  canManage,
  onEdit,
  onComplete,
  children,
}: {
  sprint: SprintDTO;
  tasks: TaskDTO[];
  doneColumnId: string | null;
  canManage: boolean;
  onEdit: () => void;
  onComplete: () => void;
  children: React.ReactNode;
}) {
  const total = points(tasks);
  const done = points(tasks.filter((t) => t.columnId === doneColumnId));
  const pct = total ? Math.round((done / total) * 100) : 0;
  const daysLeft = sprint.endDate ? diffDays(todayISO(), sprint.endDate) : null;
  return (
    <section className="overflow-hidden rounded-xl border border-primary/30 bg-white shadow-card">
      <div className="bg-linear-to-r from-primary-soft to-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-0.5 text-[12.5px] font-semibold text-white">
            <Rocket className="h-3.5 w-3.5" /> Active
          </span>
          <h2 className="text-xl font-bold tracking-tight">{sprint.name}</h2>
          <DateRange s={sprint} />
          {daysLeft !== null && (
            <span className={cn("rounded-full px-2 py-0.5 text-[13px] font-semibold", daysLeft < 0 ? "bg-red-50 text-red-600" : daysLeft <= 2 ? "bg-amber-50 text-amber-700" : "bg-white text-muted")}>
              {daysLeft < 0 ? `${-daysLeft} day${daysLeft === -1 ? "" : "s"} over` : daysLeft === 0 ? "Ends today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
            </span>
          )}
          {canManage && (
            <div className="ml-auto flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={onEdit} aria-label="Edit sprint"><Pencil className="h-4 w-4" /></Button>
              <Button size="sm" onClick={onComplete}><CheckCircle2 className="h-4 w-4" /> Complete sprint</Button>
            </div>
          )}
        </div>
        {sprint.goal && <p className="mt-2 flex items-center gap-2 text-[15px] text-foreground"><Target className="h-4 w-4 text-primary" /> {sprint.goal}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px] text-muted">
          <span><b className="text-foreground">{sprint.committedPoints ?? 0}</b> pts committed</span>
          <span><b className="text-foreground">{total}</b> pts in scope</span>
          <span><b className="text-foreground">{done}</b> pts done</span>
          <div className="flex min-w-48 flex-1 items-center gap-2.5">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: COMPLETED_COLOR }} />
            </div>
            <b className="text-foreground">{pct}%</b>
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

function TaskZone({ id, tasks, props, empty }: { id: string; tasks: TaskDTO[]; props: Props; empty: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("min-h-16 divide-y divide-border transition-colors", isOver && "bg-primary-soft/60")}>
      {tasks.map((t) => <DraggableRow key={t.id} task={t} props={props} />)}
      {tasks.length === 0 && <p className="px-5 py-5 text-center text-[14px] text-subtle">{empty}</p>}
    </div>
  );
}

function DraggableRow({ task, props }: { task: TaskDTO; props: Props }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !props.canEdit });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn(isDragging && "opacity-30", props.canEdit && "cursor-grab active:cursor-grabbing")}>
      <TaskRowBody task={task} props={props} />
    </div>
  );
}

function TaskRowBody({ task, props, className }: { task: TaskDTO; props: Props; className?: string }) {
  const ci = props.columns.findIndex((c) => c.id === task.columnId);
  const color = props.colorOf(Math.max(0, ci));
  const done = task.columnId === props.doneColumnId;
  const assignee = task.assigneeId ? props.memberById.get(task.assigneeId) : undefined;
  return (
    <div
      onClick={() => props.onOpen(task.id)}
      className={cn("flex items-center gap-3 bg-white px-5 py-2.5 transition-colors hover:bg-[#fafafe]", props.flash[task.id] && "animate-flash", className)}
    >
      <TypeIcon type={task.type} size={18} />
      <span className="w-16 shrink-0 text-[13px] text-subtle">{props.refOf(task)}</span>
      <span className={cn("min-w-0 flex-1 truncate text-[15px] font-medium", done && "text-muted line-through")}>{task.title}</span>
      <BreakdownBadges taskId={task.id} decor={props.decor} maxTags={1} className="hidden shrink-0 flex-nowrap lg:flex" />
      <span className="hidden shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold uppercase text-white sm:inline" style={{ backgroundColor: color }}>
        {props.columns[ci]?.title}
      </span>
      <PriorityFlag priority={task.priority} />
      {assignee ? <Avatar id={assignee.id} name={assignee.name} src={assignee.avatarUrl} size={24} /> : <span className="w-6" />}
      <span className="w-7 text-right">
        <PointsBadge points={task.storyPoints} />
      </span>
    </div>
  );
}

/* ---------------------------------- reports --------------------------------- */

function ReportPanel({ organizationId, projectId, sprints, tasks }: { organizationId: string; projectId: string; sprints: SprintDTO[]; tasks: TaskDTO[] }) {
  const reportable = sprints.filter((s) => s.status !== "planned");
  const [selected, setSelected] = useState<string | null>(null);
  const sprintId = selected && reportable.some((s) => s.id === selected) ? selected : (reportable[0]?.id ?? null);
  const [mode, setMode] = useState<"burndown" | "burnup">("burndown");
  const [report, setReport] = useState<SprintReport | null>(null);
  const [velocity, setVelocity] = useState<{ id: string; name: string; committed: number; completed: number }[] | null>(null);

  // Refetch when the selected sprint changes or any task in the project changes.
  const versionKey = tasks.reduce((s, t) => s + t.version, 0) + tasks.length * 1000;
  useEffect(() => {
    if (!sprintId) return setReport(null);
    const id = setTimeout(async () => {
      const r = await sprintReportAction(organizationId, sprintId);
      if (r.ok) setReport(r.report);
    }, 300);
    return () => clearTimeout(id);
  }, [organizationId, sprintId, versionKey, sprints]);
  useEffect(() => {
    velocityAction(organizationId, projectId).then((r) => r.ok && setVelocity(r.velocity));
  }, [organizationId, projectId, sprints]);

  const days = report?.days ?? [];
  const labels = days.map((d) => d.day);
  const past = (v: number, d: { future: boolean }) => (d.future ? null : v);
  const avg = velocity?.length ? Math.round(velocity.reduce((s, v) => s + v.completed, 0) / velocity.length) : null;

  return (
    <aside className="hidden w-[460px] shrink-0 space-y-4 overflow-y-auto border-l border-border bg-white/60 p-5 2xl:w-[540px] xl:block">
      {sprintId && report ? (
        <ChartFrame
          title={mode === "burndown" ? "Burndown" : "Burnup"}
          subtitle={`${report.sprint.name} · story points`}
          legend={
            mode === "burndown"
              ? [
                  { label: "Remaining", color: REMAINING_COLOR },
                  { label: "Ideal", color: IDEAL_COLOR, dashed: true },
                ]
              : [
                  { label: "Scope", color: SCOPE_COLOR },
                  { label: "Completed", color: COMPLETED_COLOR },
                ]
          }
          actions={
            <div className="flex items-center gap-2">
              {reportable.length > 1 && (
                <Select aria-label="Sprint" value={sprintId} onChange={(e) => setSelected(e.target.value)} className="h-8 w-44 py-0 text-[13.5px]">
                  {reportable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              )}
              <div className="flex rounded-md border border-border bg-surface-2 p-0.5">
                {(["burndown", "burnup"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)} className={cn("cursor-pointer rounded px-2 py-0.5 text-[12.5px] font-medium capitalize", mode === m ? "bg-white shadow-card" : "text-muted")}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          }
          table={
            <SimpleTable
              head={["Day", "Scope", "Completed", "Remaining", "Ideal"]}
              rows={days.filter((d) => !d.future).map((d) => [formatShort(d.day), d.scopePoints, d.completedPoints, d.remainingPoints, d.ideal ?? "—"])}
            />
          }
        >
          {days.length ? (
            <LineChart
              days={labels}
              series={
                mode === "burndown"
                  ? [
                      { key: "ideal", label: "Ideal", color: IDEAL_COLOR, values: days.map((d) => d.ideal), dashed: true, reference: true },
                      { key: "remaining", label: "Remaining", color: REMAINING_COLOR, values: days.map((d) => past(d.remainingPoints, d)) },
                    ]
                  : [
                      { key: "scope", label: "Scope", color: SCOPE_COLOR, values: days.map((d) => past(d.scopePoints, d)) },
                      { key: "completed", label: "Completed", color: COMPLETED_COLOR, values: days.map((d) => past(d.completedPoints, d)) },
                    ]
              }
            />
          ) : (
            <p className="py-10 text-center text-[14px] text-subtle">This sprint has no dates yet.</p>
          )}
        </ChartFrame>
      ) : (
        <div className="rounded-xl border border-dashed border-border-strong bg-white p-8 text-center">
          <p className="text-[15px] font-semibold">Burndown appears once a sprint starts</p>
          <p className="mt-1 text-[14px] text-muted">Progress is recorded every day the sprint is active.</p>
        </div>
      )}

      <ChartFrame
        title="Velocity"
        subtitle={avg !== null ? `Average ${avg} pts per sprint` : "Story points per completed sprint"}
        legend={[
          { label: "Committed", color: SCOPE_COLOR },
          { label: "Completed", color: COMPLETED_COLOR },
        ]}
        table={<SimpleTable head={["Sprint", "Committed", "Completed"]} rows={(velocity ?? []).map((v) => [v.name, v.committed, v.completed])} />}
      >
        {velocity ? <VelocityChart data={velocity} /> : <div className="h-48 animate-pulse rounded-lg bg-surface-2" />}
      </ChartFrame>
    </aside>
  );
}

/* ---------------------------------- dialogs --------------------------------- */

function SprintDialog({
  sprint,
  onClose,
  onSave,
  pending,
}: {
  sprint: SprintDTO | null;
  onClose: () => void;
  onSave: (input: { name: string; goal: string | null; startDate: string | null; endDate: string | null }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState(sprint?.name ?? "");
  const [goal, setGoal] = useState(sprint?.goal ?? "");
  const [startDate, setStartDate] = useState(sprint?.startDate ?? "");
  const [endDate, setEndDate] = useState(sprint?.endDate ?? "");
  const invalid = !!startDate && !!endDate && startDate > endDate;
  return (
    <Sheet side="center" title={sprint ? `Edit ${sprint.name}` : "Create sprint"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          onSave({ name: name.trim() || (sprint?.name ?? ""), goal: goal.trim() || null, startDate: startDate || null, endDate: endDate || null });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="sp-name">Name</Label>
          <Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={sprint ? undefined : "Leave empty for “Sprint N”"} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sp-goal">Sprint goal</Label>
          <Textarea id="sp-goal" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={500} placeholder="What should this sprint achieve?" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sp-start">Start date</Label>
            <Input id="sp-start" type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sp-end">End date</Label>
            <Input id="sp-end" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className={invalid ? "border-red-300" : undefined} />
          </div>
        </div>
        {!sprint && <p className="text-[13px] text-subtle">Dates default to two weeks, starting after your latest sprint.</p>}
        {invalid && <p className="text-[13px] text-red-600">The end date must be on or after the start date.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || invalid}>{sprint ? "Save" : "Create sprint"}</Button>
        </div>
      </form>
    </Sheet>
  );
}

function CompleteDialog({
  sprint,
  open,
  planned,
  onClose,
  onConfirm,
  pending,
}: {
  sprint: SprintDTO;
  open: TaskDTO[];
  planned: SprintDTO[];
  onClose: () => void;
  onConfirm: (moveTo: string) => void;
  pending: boolean;
}) {
  const [moveTo, setMoveTo] = useState(planned[0]?.id ?? "backlog");
  return (
    <Sheet side="center" title={`Complete ${sprint.name}`} onClose={onClose}>
      <div className="space-y-4">
        {open.length === 0 ? (
          <p className="text-[15px]">Every task in this sprint is done. 🎉</p>
        ) : (
          <>
            <p className="text-[15px]">
              <b>{open.length}</b> unfinished task{open.length === 1 ? "" : "s"} ({points(open)} pts). Where should they go?
            </p>
            <Select aria-label="Move unfinished tasks to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              {planned.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="backlog">Backlog</option>
            </Select>
          </>
        )}
        <p className="text-[13.5px] text-subtle">Completed sprints are saved to your velocity history and can&apos;t be edited.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending} onClick={() => onConfirm(moveTo)}><CheckCircle2 className="h-4 w-4" /> Complete sprint</Button>
        </div>
      </div>
    </Sheet>
  );
}
