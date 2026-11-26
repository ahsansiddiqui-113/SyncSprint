"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, ChevronDown, Loader2, Pencil, Plus, Trash2, X, XCircle, Zap } from "lucide-react";
import type { AutomationAction, AutomationCondition, AutomationTrigger } from "@/db/schema";
import { hasRole } from "@/lib/rbac-shared";
import { cn, timeAgo } from "@/lib/utils";
import {
  automationRunsAction,
  deleteAutomationAction,
  listAutomationsAction,
  saveAutomationAction,
  setAutomationEnabledAction,
} from "@/actions/automation.actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Sheet } from "./sheet";
import type { BoardCtx } from "./kanban-board";

type Rule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  runCount: number;
  lastRunAt: string | null;
};
type Draft = Omit<Rule, "id" | "runCount" | "lastRunAt">;
type Tag = { id: string; name: string; color: string };

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const TYPES = ["epic", "story", "task", "bug"] as const;

/* ------------------------------ sentence summary ------------------------------ */

function describe(ctx: BoardCtx, tags: Tag[], d: Draft) {
  const col = (id: string | null) => (id ? (ctx.columns.find((c) => c.id === id)?.title ?? "a deleted status") : "any status");
  const person = (id: string | null | undefined) => (id === "actor" ? "the person who made the change" : id ? (ctx.members.find((m) => m.id === id)?.name ?? "someone") : "nobody");
  const t = d.trigger;
  const when =
    t.kind === "task_created" ? "a task is created"
      : t.kind === "status_changed" ? `status changes to ${col(t.toColumnId)}`
        : t.kind === "assignee_changed" ? "the assignee changes"
          : t.kind === "priority_changed" ? `priority changes to ${t.to ?? "anything"}`
            : t.kind === "due_soon" ? (t.days === 0 ? "a task is due today" : `a task is due within ${t.days} day${t.days === 1 ? "" : "s"}`)
              : t.kind === "overdue" ? "a task becomes overdue"
                : `every ${t.every === "week" ? WEEKDAYS[t.weekday ?? 0] : t.every === "weekday" ? "weekday" : "day"} at ${String(t.hour).padStart(2, "0")}:00 (${t.timezone}), for each open task`;
  const cond = d.conditions.map((c) => {
    const v = c.field === "assignee" ? person(c.value) : c.field === "tag" ? (tags.find((x) => x.id === c.value)?.name ?? "a tag") : c.field === "team" ? (c.value ? (ctx.teams.find((t) => t.id === c.value)?.name ?? "a deleted group") : "no group") : c.field === "status" ? col(c.value) : c.value;
    return `${c.field} ${c.op === "is" ? (c.field === "tag" ? "includes" : "is") : c.field === "tag" ? "doesn't include" : "isn't"} ${v}`;
  });
  const then = d.actions.map((a) => {
    switch (a.type) {
      case "move_to_status": return `move to ${col(a.columnId)}`;
      case "set_assignee": return a.userId ? `assign to ${person(a.userId)}` : "unassign";
      case "set_priority": return `set priority ${a.priority}`;
      case "add_tag": return `tag ${tags.find((x) => x.id === a.tagId)?.name ?? "(deleted tag)"}`;
      case "assign_to_team": return a.teamId ? `send to ${ctx.teams.find((t) => t.id === a.teamId)?.name ?? "a deleted group"}` : "remove from its group";
      case "set_due_in_days": return a.days === 0 ? "make it due today" : `make it due in ${a.days} day${a.days === 1 ? "" : "s"}`;
      case "add_comment": return "post a comment";
      case "notify": return a.target === "user" ? `notify ${person(a.userId)}` : `notify the ${a.target === "assignee" ? "assignees" : "watchers"}`;
    }
  });
  return { when, cond, then };
}

/* --------------------------------- templates --------------------------------- */

function templates(ctx: BoardCtx): { label: string; draft: Draft }[] {
  const first = ctx.columns[0]?.id;
  const second = ctx.columns[1]?.id ?? first;
  const done = ctx.columns[ctx.columns.length - 1]?.id ?? null;
  return [
    {
      label: "Assign work to whoever starts it",
      draft: { name: "Assign on start", enabled: true, trigger: { kind: "status_changed", toColumnId: second ?? null }, conditions: [{ field: "assignee", op: "is", value: null }], actions: [{ type: "set_assignee", userId: "actor" }] },
    },
    {
      label: "Urgent bugs jump the queue",
      draft: {
        name: "Urgent bugs first", enabled: true, trigger: { kind: "task_created" },
        conditions: [{ field: "type", op: "is", value: "bug" }, { field: "priority", op: "is", value: "urgent" }],
        actions: [{ type: "move_to_status", columnId: second! }, { type: "set_due_in_days", days: 1 }, { type: "notify", target: "assignee", message: "Urgent bug — please take a look today." }],
      },
    },
    {
      label: "Tell watchers when work is done",
      draft: { name: "Done → watchers", enabled: true, trigger: { kind: "status_changed", toColumnId: done }, conditions: [], actions: [{ type: "notify", target: "watchers", message: "This is done. Check it out." }] },
    },
  ];
}

const blank = (ctx: BoardCtx): Draft => ({ name: "", enabled: true, trigger: { kind: "status_changed", toColumnId: ctx.columns[ctx.columns.length - 1]?.id ?? null }, conditions: [], actions: [{ type: "set_assignee", userId: "actor" }] });

/* ----------------------------------- panel ----------------------------------- */

export function AutomationsPanel({ ctx, tags, onClose }: { ctx: BoardCtx; tags: Tag[]; onClose: () => void }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const canManage = hasRole(ctx.role, "admin");

  const load = useCallback(() => {
    listAutomationsAction(ctx.org.id, ctx.project.id).then((r) => (r.ok ? setRules(r.automations) : toast.error(r.message)));
  }, [ctx.org.id, ctx.project.id]);
  useEffect(load, [load]);

  return (
    <Sheet
      title={
        <span className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" /> Automations · {ctx.project.name}
        </span>
      }
      onClose={onClose}
    >
      {editing ? (
        <Editor ctx={ctx} tags={tags} initial={editing} onCancel={() => setEditing(null)} onSaved={() => (setEditing(null), load())} />
      ) : (
        <>
          <p className="text-[15px] text-muted">
            When something happens to a task in this project, do the busywork automatically. Rules run instantly, in the same save as the change that triggered them, and never trigger each other.
          </p>
          {canManage && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setEditing({ id: null, draft: blank(ctx) })}>
                <Plus className="h-4 w-4" /> New automation
              </Button>
              {templates(ctx).map((t) => (
                <Button key={t.label} size="sm" variant="outline" onClick={() => setEditing({ id: null, draft: t.draft })}>
                  {t.label}
                </Button>
              ))}
            </div>
          )}
          <div className="mt-5 space-y-3">
            {rules === null && <p className="text-[15px] text-subtle">Loading…</p>}
            {rules?.length === 0 && (
              <div className="rounded-xl border border-dashed border-border-strong p-8 text-center">
                <Zap className="mx-auto h-8 w-8 text-subtle" />
                <p className="mt-2 font-medium">No automations yet</p>
                <p className="text-[15px] text-subtle">{canManage ? "Start from a template above or build your own." : "Owners and admins can set up automations."}</p>
              </div>
            )}
            {rules?.map((r) => (
              <RuleCard key={r.id} ctx={ctx} tags={tags} rule={r} canManage={canManage} onEdit={() => setEditing({ id: r.id, draft: r })} onChanged={load} />
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

function RuleCard({ ctx, tags, rule, canManage, onEdit, onChanged }: { ctx: BoardCtx; tags: Tag[]; rule: Rule; canManage: boolean; onEdit: () => void; onChanged: () => void }) {
  const [runs, setRuns] = useState<{ id: string; ok: boolean; detail: string; createdAt: string; taskNumber: number | null }[] | null>(null);
  const [pending, start] = useTransition();
  const s = describe(ctx, tags, rule);
  return (
    <div className={cn("rounded-xl border border-border bg-white p-4 transition", !rule.enabled && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", rule.enabled ? "bg-primary-soft text-primary" : "bg-surface-2 text-subtle")}>
          <Zap className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{rule.name}</div>
          <p className="mt-1 text-[14.5px] leading-relaxed text-muted">
            <b className="font-medium text-foreground">When</b> {s.when}
            {s.cond.length > 0 && (
              <>
                {" "}<b className="font-medium text-foreground">and</b> {s.cond.join(" and ")}
              </>
            )}
            {" "}<ArrowRight className="inline h-3.5 w-3.5" /> {s.then.join(", ")}.
          </p>
          <div className="mt-2 flex items-center gap-3 text-[13px] text-subtle">
            <span>{rule.runCount ? `Ran ${rule.runCount} time${rule.runCount === 1 ? "" : "s"}${rule.lastRunAt ? `, last ${timeAgo(rule.lastRunAt)}` : ""}` : "Hasn't run yet"}</span>
            <button
              className="inline-flex cursor-pointer items-center gap-0.5 hover:text-foreground"
              onClick={() => (runs ? setRuns(null) : automationRunsAction(ctx.org.id, rule.id).then((r) => r.ok && setRuns(r.runs)))}
            >
              History <ChevronDown className={cn("h-3.5 w-3.5 transition", runs && "rotate-180")} />
            </button>
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 items-center gap-1">
            <label className="relative inline-flex cursor-pointer items-center" title={rule.enabled ? "Turn off" : "Turn on"}>
              <input
                type="checkbox"
                className="peer sr-only"
                checked={rule.enabled}
                disabled={pending}
                aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                onChange={(e) =>
                  start(async () => {
                    const r = await setAutomationEnabledAction(ctx.org.id, rule.id, e.target.checked);
                    if (!r.ok) return void toast.error(r.message);
                    onChanged();
                  })
                }
              />
              <span className="h-5 w-9 rounded-full bg-border-strong transition peer-checked:bg-primary peer-focus-visible:ring-4 peer-focus-visible:ring-primary/20" />
              <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
            </label>
            <button aria-label={`Edit ${rule.name}`} onClick={onEdit} className="cursor-pointer rounded-md p-1.5 text-subtle hover:bg-hover hover:text-foreground">
              <Pencil className="h-4 w-4" />
            </button>
            <button
              aria-label={`Delete ${rule.name}`}
              className="cursor-pointer rounded-md p-1.5 text-subtle hover:bg-hover hover:text-rose-600"
              onClick={() => {
                if (!confirm(`Delete the automation “${rule.name}”?`)) return;
                start(async () => {
                  const r = await deleteAutomationAction(ctx.org.id, rule.id);
                  if (!r.ok) return void toast.error(r.message);
                  onChanged();
                });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {runs && (
        <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-[13.5px]">
          {runs.length === 0 && <li className="text-subtle">No runs yet.</li>}
          {runs.map((r) => (
            <li key={r.id} className="flex items-start gap-2">
              {r.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />}
              <span className="min-w-0 flex-1">
                {r.taskNumber && <span className="mr-1.5 font-mono text-[12.5px] text-subtle">{ctx.project.key}-{r.taskNumber}</span>}
                {r.detail}
              </span>
              <span className="shrink-0 text-subtle">{timeAgo(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----------------------------------- editor ----------------------------------- */

function Editor({ ctx, tags, initial, onCancel, onSaved }: { ctx: BoardCtx; tags: Tag[]; initial: { id: string | null; draft: Draft }; onCancel: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>(initial.draft);
  const [pending, start] = useTransition();
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const s = describe(ctx, tags, d);

  const save = () =>
    start(async () => {
      const r = await saveAutomationAction(ctx.org.id, ctx.project.id, initial.id, { ...d, name: d.name.trim() || s.when.replace(/^./, (c) => c.toUpperCase()) });
      if (!r.ok) return void toast.error(r.message);
      toast.success(initial.id ? "Automation updated" : "Automation is live");
      onSaved();
    });

  const colOptions = ctx.columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>);
  const people = ctx.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>);

  return (
    <div className="space-y-6">
      <div>
        <label className="text-[14px] font-medium text-muted" htmlFor="auto-name">Name</label>
        <Input id="auto-name" value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Assign on start" maxLength={120} className="mt-1.5" />
      </div>

      <Block step="1" title="When">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            aria-label="Trigger"
            value={d.trigger.kind}
            onChange={(e) => {
              const k = e.target.value as AutomationTrigger["kind"];
              set({
                trigger:
                  k === "status_changed" ? { kind: k, toColumnId: null }
                    : k === "priority_changed" ? { kind: k, to: null }
                      : k === "due_soon" ? { kind: k, days: 1 }
                        : k === "schedule" ? { kind: k, every: "weekday", hour: 9, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }
                          : { kind: k },
                // A scheduled rule has no "person who made the change".
                actions: k === "due_soon" || k === "overdue" || k === "schedule" ? d.actions.filter((a) => !(a.type === "set_assignee" && a.userId === "actor")) : d.actions,
              });
            }}
          >
            <option value="task_created">A task is created</option>
            <option value="status_changed">Status changes</option>
            <option value="assignee_changed">Assignee changes</option>
            <option value="priority_changed">Priority changes</option>
            <option value="due_soon">A due date is coming up</option>
            <option value="overdue">A task becomes overdue</option>
            <option value="schedule">On a schedule</option>
          </Select>
          {d.trigger.kind === "due_soon" && (
            <Select aria-label="Days before due" value={d.trigger.days} onChange={(e) => set({ trigger: { kind: "due_soon", days: Number(e.target.value) } })}>
              {[0, 1, 2, 3, 5, 7, 14].map((n) => <option key={n} value={n}>{n === 0 ? "on the due date" : `${n} day${n === 1 ? "" : "s"} before`}</option>)}
            </Select>
          )}
          {d.trigger.kind === "schedule" && (() => {
            const t = d.trigger;
            return (
              <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                <Select aria-label="How often" value={t.every === "week" ? `w${t.weekday ?? 0}` : t.every} onChange={(e) => {
                  const v = e.target.value;
                  set({ trigger: v.startsWith("w") && v !== "weekday" ? { ...t, every: "week", weekday: Number(v.slice(1)) } : { ...t, every: v as "day" | "weekday", weekday: undefined } });
                }}>
                  <option value="day">Every day</option>
                  <option value="weekday">Every weekday</option>
                  {WEEKDAYS.map((w, i) => <option key={w} value={`w${i}`}>Every {w}</option>)}
                </Select>
                <Select aria-label="Time" value={t.hour} onChange={(e) => set({ trigger: { ...t, hour: Number(e.target.value) } })}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00 ({t.timezone})</option>)}
                </Select>
              </div>
            );
          })()}
          {d.trigger.kind === "status_changed" && (
            <Select aria-label="To status" value={d.trigger.toColumnId ?? ""} onChange={(e) => set({ trigger: { kind: "status_changed", toColumnId: e.target.value || null } })}>
              <option value="">to any status</option>
              {ctx.columns.map((c) => <option key={c.id} value={c.id}>to {c.title}</option>)}
            </Select>
          )}
          {d.trigger.kind === "priority_changed" && (
            <Select aria-label="To priority" value={d.trigger.to ?? ""} onChange={(e) => set({ trigger: { kind: "priority_changed", to: (e.target.value || null) as never } })}>
              <option value="">to any priority</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>to {p}</option>)}
            </Select>
          )}
        </div>
      </Block>

      <Block step="2" title="Only if (optional)">
        <div className="space-y-2">
          {d.conditions.map((c, i) => (
            <div key={i} className="grid grid-cols-[8rem_7rem_1fr_auto] gap-2">
              <Select aria-label="Field" value={c.field} onChange={(e) => set({ conditions: d.conditions.map((x, j) => (j === i ? { field: e.target.value as never, op: "is", value: null } : x)) })}>
                <option value="priority">Priority</option>
                <option value="type">Type</option>
                <option value="assignee">Assignee</option>
                <option value="tag">Tag</option>
                <option value="team">Group</option>
                <option value="status">Status</option>
              </Select>
              <Select aria-label="Operator" value={c.op} onChange={(e) => set({ conditions: d.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as never } : x)) })}>
                <option value="is">{c.field === "tag" ? "includes" : "is"}</option>
                <option value="is_not">{c.field === "tag" ? "excludes" : "is not"}</option>
              </Select>
              <Select aria-label="Value" value={c.value ?? ""} onChange={(e) => set({ conditions: d.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value || null } : x)) })}>
                {c.field === "priority" && <><option value="">Choose…</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</>}
                {c.field === "type" && <><option value="">Choose…</option>{TYPES.map((p) => <option key={p} value={p}>{p}</option>)}</>}
                {c.field === "assignee" && <><option value="">Unassigned</option>{people}</>}
                {c.field === "tag" && <><option value="">Choose…</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</>}
                {c.field === "team" && <><option value="">No group</option>{ctx.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</>}
                {c.field === "status" && <><option value="">Choose…</option>{ctx.columns.map((col) => <option key={col.id} value={col.id}>{col.title}</option>)}</>}
              </Select>
              <RemoveBtn onClick={() => set({ conditions: d.conditions.filter((_, j) => j !== i) })} />
            </div>
          ))}
          {d.conditions.length < 5 && (
            <AddBtn label="Add condition" onClick={() => set({ conditions: [...d.conditions, { field: "priority", op: "is", value: "urgent" }] })} />
          )}
        </div>
      </Block>

      <Block step="3" title="Then">
        <div className="space-y-2">
          {d.actions.map((a, i) => {
            const upd = (x: AutomationAction) => set({ actions: d.actions.map((y, j) => (j === i ? x : y)) });
            return (
              <div key={i} className="rounded-lg border border-border bg-elevated p-2.5">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Select aria-label="Action" value={a.type} onChange={(e) => upd(defaultAction(ctx, tags, e.target.value as AutomationAction["type"]))}>
                    <option value="move_to_status">Move to status</option>
                    <option value="set_assignee">Change assignee</option>
                    <option value="set_priority">Set priority</option>
                    <option value="add_tag">Add a tag</option>
                    <option value="assign_to_team">Send to a group</option>
                    <option value="set_due_in_days">Set due date</option>
                    <option value="add_comment">Post a comment</option>
                    <option value="notify">Send a notification</option>
                  </Select>
                  <RemoveBtn onClick={() => set({ actions: d.actions.filter((_, j) => j !== i) })} />
                </div>
                <div className="mt-2">
                  {a.type === "move_to_status" && <Select aria-label="Status" value={a.columnId} onChange={(e) => upd({ ...a, columnId: e.target.value })}>{colOptions}</Select>}
                  {a.type === "set_assignee" && (
                    <Select aria-label="Assignee" value={a.userId ?? ""} onChange={(e) => upd({ ...a, userId: e.target.value === "" ? null : e.target.value })}>
                      <option value="actor">The person who made the change</option>
                      <option value="">Nobody (unassign)</option>
                      {people}
                    </Select>
                  )}
                  {a.type === "set_priority" && (
                    <Select aria-label="Priority" value={a.priority} onChange={(e) => upd({ ...a, priority: e.target.value as never })}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  )}
                  {a.type === "add_tag" && (
                    tags.length ? (
                      <Select aria-label="Tag" value={a.tagId} onChange={(e) => upd({ ...a, tagId: e.target.value })}>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
                    ) : <p className="text-[13.5px] text-subtle">Create a tag on any task first.</p>
                  )}
                  {a.type === "assign_to_team" && (
                    ctx.teams.length ? (
                      <Select aria-label="Group" value={a.teamId ?? ""} onChange={(e) => upd({ ...a, teamId: e.target.value || null })}>
                        <option value="">Remove from its group</option>
                        {ctx.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </Select>
                    ) : <p className="text-[13.5px] text-subtle">Create a group first (Groups in the sidebar).</p>
                  )}
                  {a.type === "set_due_in_days" && (
                    <div className="flex items-center gap-2 text-[14.5px]">
                      Due in
                      <Input type="number" min={0} max={365} value={a.days} onChange={(e) => upd({ ...a, days: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) })} className="h-10 w-24" aria-label="Days" />
                      days from when it runs
                    </div>
                  )}
                  {a.type === "add_comment" && <Input value={a.body} onChange={(e) => upd({ ...a, body: e.target.value })} maxLength={1000} placeholder="Comment text" aria-label="Comment" className="h-10" />}
                  {a.type === "notify" && (
                    <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
                      <Select aria-label="Who" value={a.target === "user" ? (a.userId ?? "") : a.target} onChange={(e) => {
                        const v = e.target.value;
                        upd(v === "assignee" || v === "watchers" ? { ...a, target: v, userId: null } : { ...a, target: "user", userId: v });
                      }}>
                        <option value="assignee">Assignees</option>
                        <option value="watchers">Watchers</option>
                        {people}
                      </Select>
                      <Input value={a.message} onChange={(e) => upd({ ...a, message: e.target.value })} maxLength={200} placeholder="Message" aria-label="Message" className="h-10" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {d.actions.length < 5 && <AddBtn label="Add action" onClick={() => set({ actions: [...d.actions, defaultAction(ctx, tags, "set_priority")] })} />}
        </div>
      </Block>

      <div className="rounded-xl bg-primary-soft/60 p-3.5 text-[14.5px] leading-relaxed">
        <b>When</b> {s.when}
        {s.cond.length > 0 && <> <b>and</b> {s.cond.join(" and ")}</>} <ArrowRight className="inline h-3.5 w-3.5" /> {s.then.join(", ") || "…"}.
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={pending || !d.actions.length} onClick={save}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} {initial.id ? "Save changes" : "Turn on automation"}
        </Button>
      </div>
    </div>
  );
}

function defaultAction(ctx: BoardCtx, tags: Tag[], type: AutomationAction["type"]): AutomationAction {
  switch (type) {
    case "move_to_status": return { type, columnId: ctx.columns[ctx.columns.length - 1]!.id };
    case "set_assignee": return { type, userId: "actor" };
    case "set_priority": return { type, priority: "high" };
    case "add_tag": return { type, tagId: tags[0]?.id ?? "" };
    case "assign_to_team": return { type, teamId: ctx.teams[0]?.id ?? null };
    case "set_due_in_days": return { type, days: 3 };
    case "add_comment": return { type, body: "" };
    case "notify": return { type, target: "assignee", message: "" };
  }
}

function Block({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[12.5px] font-bold text-white">{step}</span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

const AddBtn = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="inline-flex cursor-pointer items-center gap-1.5 text-[14.5px] font-medium text-primary hover:underline">
    <Plus className="h-4 w-4" /> {label}
  </button>
);
const RemoveBtn = ({ onClick }: { onClick: () => void }) => (
  <button type="button" aria-label="Remove" onClick={onClick} className="flex h-11 w-9 cursor-pointer items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-rose-600">
    <X className="h-4 w-4" />
  </button>
);
