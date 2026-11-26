"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, ChevronDown, Circle, Hash, ListChecks, Plus, Target, Trash2, X } from "lucide-react";
import type { OrgRole } from "@/db/schema";
import type { listGoals } from "@/server/services/goals";
import {
  addKeyResultAction,
  createGoalAction,
  deleteGoalAction,
  deleteKeyResultAction,
  listGoalsAction,
  setKeyResultTaskAction,
  updateKeyResultValueAction,
} from "@/actions/collab.actions";
import { can, hasRole } from "@/lib/rbac-shared";
import { cn } from "@/lib/utils";
import { formatShort, relativeDueLabel } from "@/lib/dates";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { TaskPicker } from "@/components/docs/task-picker";
import { useSignal, useVisiblePoll } from "@/components/workspace/signals";

type Goal = Awaited<ReturnType<typeof listGoals>>[number];
type KR = Goal["keyResults"][number];

const pct = (p: number) => Math.round(p * 100);
const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

function Bar({ value, size = "md" }: { value: number; size?: "md" | "lg" }) {
  const done = value >= 1;
  return (
    <div
      className={cn("overflow-hidden rounded-full bg-surface-2", size === "lg" ? "h-2.5" : "h-2")}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct(value)}
    >
      <div className={cn("h-full rounded-full transition-all duration-500", done ? "bg-emerald-500" : "bg-primary")} style={{ width: `${Math.max(value > 0 ? 2 : 0, pct(value))}%` }} />
    </div>
  );
}

export function GoalsBoard({
  org,
  role,
  initial,
  members,
}: {
  org: { id: string; slug: string };
  role: OrgRole;
  initial: Goal[];
  members: { id: string; name: string }[];
}) {
  const [goals, setGoals] = useState(initial);
  const [creating, setCreating] = useState(false);
  const isAdmin = hasRole(role, "admin");
  const canWork = can(role, "CREATE_OR_MOVE_TASK");

  const reload = useCallback(() => {
    listGoalsAction(org.id).then((r) => r.ok && setGoals(r.goals));
  }, [org.id]);
  useSignal((e) => (e.type === "GOALS_CHANGED" || e.type === "TASK_UPDATED" || e.type === "TASK_DELETED") && reload());
  useVisiblePoll(reload, 60_000);

  const overall = goals.length ? goals.reduce((s, g) => s + g.progress, 0) / goals.length : 0;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {goals.length > 0 && (
          <Card className="flex min-w-72 flex-1 items-center gap-4 px-5 py-4 sm:max-w-md">
            <Target className="h-8 w-8 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] text-muted">Across {goals.length} goal{goals.length === 1 ? "" : "s"}</span>
                <b className="text-[20px] tabular-nums">{pct(overall)}%</b>
              </div>
              <div className="mt-1.5"><Bar value={overall} /></div>
            </div>
          </Card>
        )}
        {isAdmin && !creating && (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New goal
          </Button>
        )}
      </div>

      {creating && <NewGoalForm org={org} members={members} onDone={(created) => (setCreating(false), created && reload())} />}

      {goals.length === 0 && !creating && (
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <Target className="h-9 w-9 text-subtle" />
          <p className="text-[16px] font-medium">No goals yet</p>
          <p className="max-w-md text-[15px] text-subtle">
            {isAdmin ? "Set an objective and add key results — a number to hit, or a set of tasks to finish." : "Owners and admins can set goals for the workspace."}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {goals.map((g) => (
          <GoalCard key={g.id} org={org} goal={g} isAdmin={isAdmin} canWork={canWork} onChanged={reload} />
        ))}
      </div>
    </>
  );
}

function NewGoalForm({ org, members, onDone }: { org: { id: string }; members: { id: string; name: string }[]; onDone: (created: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card className="mb-6 animate-fade-up p-5">
      <form
        className="grid gap-3 md:grid-cols-[1fr_14rem_11rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createGoalAction(org.id, { title, ownerId: ownerId || null, dueDate: dueDate || null });
            if (!r.ok) return void toast.error(r.message);
            toast.success("Goal created — now add key results");
            onDone(true);
          });
        }}
      >
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Objective, e.g. Launch the mobile app" maxLength={160} aria-label="Goal title" />
        <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} aria-label="Owner">
          <option value="">Owner: me</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
        <div className="flex gap-2">
          <Button disabled={pending || !title.trim()}>Create</Button>
          <Button type="button" variant="ghost" onClick={() => onDone(false)} aria-label="Cancel"><X className="h-4 w-4" /></Button>
        </div>
      </form>
    </Card>
  );
}

function GoalCard({ org, goal, isAdmin, canWork, onChanged }: { org: { id: string; slug: string }; goal: Goal; isAdmin: boolean; canWork: boolean; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();
  const done = goal.progress >= 1;
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[19px] font-semibold leading-snug">{goal.title}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] text-muted">
            {goal.ownerName && (
              <span className="inline-flex items-center gap-1.5">
                <Avatar id={goal.ownerId ?? "x"} name={goal.ownerName} size={20} /> {goal.ownerName}
              </span>
            )}
            {goal.dueDate && (
              <span className="inline-flex items-center gap-1.5" title={formatShort(goal.dueDate)}>
                <CalendarDays className="h-3.5 w-3.5" /> {relativeDueLabel(goal.dueDate)}
              </span>
            )}
            {done && <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Achieved</span>}
          </div>
        </div>
        <span className="text-[26px] font-bold tabular-nums leading-none">{pct(goal.progress)}%</span>
        {isAdmin && (
          <button
            aria-label={`Delete goal ${goal.title}`}
            disabled={pending}
            className="cursor-pointer rounded-md p-1.5 text-subtle hover:bg-hover hover:text-rose-600"
            onClick={() => {
              if (!confirm(`Delete the goal “${goal.title}” and its key results? This can't be undone.`)) return;
              start(async () => {
                const r = await deleteGoalAction(org.id, goal.id);
                if (!r.ok) return void toast.error(r.message);
                onChanged();
              });
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-3"><Bar value={goal.progress} size="lg" /></div>

      <div className="mt-5 flex-1 space-y-3">
        {goal.keyResults.length === 0 && <p className="text-[14.5px] text-subtle">No key results yet.{isAdmin ? " Add one to start measuring progress." : ""}</p>}
        {goal.keyResults.map((k) => (
          <KeyResultRow key={k.id} org={org} kr={k} isAdmin={isAdmin} canWork={canWork} onChanged={onChanged} />
        ))}
      </div>

      {isAdmin &&
        (adding ? (
          <NewKeyResultForm org={org} goalId={goal.id} onDone={(ok) => (setAdding(false), ok && onChanged())} />
        ) : (
          <button onClick={() => setAdding(true)} className="mt-4 inline-flex cursor-pointer items-center gap-1.5 self-start text-[14.5px] font-medium text-primary hover:underline">
            <Plus className="h-4 w-4" /> Add key result
          </button>
        ))}
    </Card>
  );
}

function KeyResultRow({ org, kr, isAdmin, canWork, onChanged }: { org: { id: string; slug: string }; kr: KR; isAdmin: boolean; canWork: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const commitValue = () => {
    if (value === null) return;
    const n = Number(value);
    if (!Number.isFinite(n) || value.trim() === "") return void setValue(null);
    start(async () => {
      const r = await updateKeyResultValueAction(org.id, kr.id, n);
      setValue(null);
      if (!r.ok) return void toast.error(r.message);
      onChanged();
    });
  };

  return (
    <div className="rounded-xl border border-border bg-elevated p-3.5">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", kr.kind === "tasks" ? "bg-sky-100 text-sky-700" : "bg-primary-soft text-primary")}>
          {kr.kind === "tasks" ? <ListChecks className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15.5px] font-medium">{kr.title}</span>
        <span className="text-[14px] font-semibold tabular-nums">{pct(kr.progress)}%</span>
        {isAdmin && (
          <button
            aria-label={`Delete key result ${kr.title}`}
            className="cursor-pointer rounded p-1 text-subtle hover:bg-hover hover:text-rose-600"
            onClick={() => {
              if (!confirm(`Delete the key result “${kr.title}”?`)) return;
              start(async () => {
                const r = await deleteKeyResultAction(org.id, kr.id);
                if (!r.ok) return void toast.error(r.message);
                onChanged();
              });
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-2.5"><Bar value={kr.progress} /></div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-muted">
        {kr.kind === "number" ? (
          <>
            {canWork && value !== null ? (
              <input
                autoFocus
                type="number"
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={commitValue}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitValue();
                  if (e.key === "Escape") setValue(null);
                }}
                aria-label={`Current value for ${kr.title}`}
                className="h-8 w-28 rounded-md border border-primary bg-white px-2 text-[14px] text-foreground outline-none ring-4 ring-primary/15"
              />
            ) : (
              <button
                disabled={!canWork || pending}
                onClick={() => setValue(String(kr.currentValue))}
                title={canWork ? "Update the current value" : undefined}
                className={cn("rounded-md px-1.5 py-0.5 font-semibold text-foreground tabular-nums", canWork && "cursor-pointer hover:bg-hover")}
              >
                {fmtNum(kr.currentValue)}
              </button>
            )}
            <span>
              of {fmtNum(kr.targetValue)} {kr.unit ?? ""} <span className="text-subtle">(from {fmtNum(kr.startValue)})</span>
            </span>
          </>
        ) : (
          <>
            <button onClick={() => setOpen((o) => !o)} className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground">
              <b className="font-semibold text-foreground">{kr.done}</b> of {kr.total} task{kr.total === 1 ? "" : "s"} done
              <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
            </button>
            {canWork && (
              <TaskPicker
                className="ml-auto"
                organizationId={org.id}
                exclude={kr.tasks.map((t) => t.id)}
                onPick={async (t) => {
                  const r = await setKeyResultTaskAction(org.id, kr.id, t.id, true);
                  if (!r.ok) return void toast.error(r.message);
                  setOpen(true);
                  onChanged();
                }}
              />
            )}
          </>
        )}
      </div>
      {kr.kind === "tasks" && open && (
        <ul className="mt-2 space-y-1">
          {kr.tasks.length === 0 && <li className="text-[14px] text-subtle">Link tasks to measure this key result by finished work.</li>}
          {kr.tasks.map((t) => (
            <li key={t.id} className="group flex items-center gap-2 text-[14.5px]">
              {t.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="h-4 w-4 shrink-0 text-subtle" />}
              <Link href={`/w/${org.slug}/projects/${t.ref.split("-")[0]}?task=${t.id}`} className={cn("min-w-0 flex-1 truncate hover:text-primary", t.done && "text-muted line-through")}>
                <span className="mr-1.5 font-mono text-[12.5px] text-subtle no-underline">{t.ref}</span>
                {t.title}
              </Link>
              {canWork && (
                <button
                  aria-label={`Unlink ${t.ref}`}
                  className="cursor-pointer rounded p-0.5 text-subtle opacity-0 hover:bg-hover group-hover:opacity-100 focus:opacity-100"
                  onClick={async () => {
                    const r = await setKeyResultTaskAction(org.id, kr.id, t.id, false);
                    if (!r.ok) return void toast.error(r.message);
                    onChanged();
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewKeyResultForm({ org, goalId, onDone }: { org: { id: string }; goalId: string; onDone: (ok: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"number" | "tasks">("number");
  const [startValue, setStartValue] = useState("0");
  const [targetValue, setTargetValue] = useState("100");
  const [unit, setUnit] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-4 animate-fade-up space-y-3 rounded-xl border border-dashed border-border-strong p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addKeyResultAction(org.id, goalId, {
            title,
            kind,
            ...(kind === "number" ? { startValue: Number(startValue), targetValue: Number(targetValue), unit: unit || null } : {}),
          });
          if (!r.ok) return void toast.error(r.message);
          onDone(true);
        });
      }}
    >
      <div className="flex gap-2">
        <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Key result, e.g. Reach 500 beta signups" maxLength={160} aria-label="Key result title" className="h-10" />
        <div className="flex shrink-0 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label="Measure by">
          {(["number", "tasks"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn("cursor-pointer rounded-md px-3 text-[14px] font-medium text-muted", kind === k && "bg-white text-foreground shadow-card")}
            >
              {k === "number" ? "Number" : "Tasks"}
            </button>
          ))}
        </div>
      </div>
      {kind === "number" ? (
        <div className="grid grid-cols-3 gap-2">
          <label className="text-[13px] text-muted">Start<Input type="number" step="any" value={startValue} onChange={(e) => setStartValue(e.target.value)} className="mt-1 h-10" /></label>
          <label className="text-[13px] text-muted">Target<Input type="number" step="any" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className="mt-1 h-10" /></label>
          <label className="text-[13px] text-muted">Unit<Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="users, %, $" maxLength={20} className="mt-1 h-10" /></label>
        </div>
      ) : (
        <p className="text-[13.5px] text-muted">Progress follows linked tasks: each one finished (in its project's last status) counts.</p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(false)}>Cancel</Button>
        <Button size="sm" disabled={pending || !title.trim()}>Add key result</Button>
      </div>
    </form>
  );
}
