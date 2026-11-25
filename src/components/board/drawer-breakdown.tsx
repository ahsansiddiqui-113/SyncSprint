"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Ban, Check, CornerDownRight, GitBranch, Link2, ListChecks, Plus, Search, Trash2, X } from "lucide-react";
import type { TaskDTO } from "@/lib/realtime-protocol";
import { can } from "@/lib/rbac-shared";
import { TAG_COLORS } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";
import { createTaskAction } from "@/actions/task.actions";
import {
  addChecklistItemAction,
  addDependencyAction,
  createTagAction,
  deleteChecklistItemAction,
  listChecklistAction,
  removeDependencyAction,
  setChecklistItemDoneAction,
  setTaskTagAction,
} from "@/actions/breakdown.actions";
import { Avatar } from "@/components/ui/avatar";
import { PriorityFlag } from "@/components/ui/badge";
import { Popover } from "@/components/ui/popover";
import { Section } from "./sheet";
import { TagChip } from "./task-meta";
import type { TaskDecor } from "./decor";
import type { BoardCtx } from "./kanban-board";

type Item = { id: string; text: string; done: boolean; position: number };

export type BreakdownProps = {
  ctx: BoardCtx;
  task: TaskDTO;
  allTasks: Record<string, TaskDTO>;
  decor: TaskDecor;
  metaVersion: number;
  onMetaChanged: () => void;
  onOpenTask: (id: string) => void;
  onToggleDone: (t: TaskDTO) => void;
  onCreated: (ts: TaskDTO[]) => void;
};

const doneCol = (ctx: BoardCtx) => ctx.columns[ctx.columns.length - 1]?.id;
const refOf = (ctx: BoardCtx, t: { taskNumber: number }) => `${ctx.project.key}-${t.taskNumber}`;

/** Parent breadcrumb for subtasks: click to jump to the parent. */
export function ParentLink({ ctx, task, allTasks, onOpenTask }: Pick<BreakdownProps, "ctx" | "task" | "allTasks" | "onOpenTask">) {
  const parent = task.parentId ? allTasks[task.parentId] : undefined;
  if (!parent) return null;
  return (
    <button
      onClick={() => onOpenTask(parent.id)}
      className="mb-2 inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-[14px] text-muted hover:bg-hover hover:text-foreground"
    >
      <CornerDownRight className="h-4 w-4 shrink-0" />
      Subtask of <b className="shrink-0 font-semibold">{refOf(ctx, parent)}</b>
      <span className="truncate">{parent.title}</span>
    </button>
  );
}

/* ----------------------------------- tags ---------------------------------- */

export function TagsField({ ctx, task, decor, onMetaChanged }: Pick<BreakdownProps, "ctx" | "task" | "decor" | "onMetaChanged">) {
  const canEdit = can(ctx.role, "CREATE_OR_MOVE_TASK");
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLORS[0]);
  const mine = decor.tagsByTask[task.id] ?? [];
  const toggle = (tagId: string, on: boolean) =>
    start(async () => {
      const r = await setTaskTagAction(ctx.org.id, task.id, tagId, on);
      if (!r.ok) return void toast.error(r.message);
      onMetaChanged();
    });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {mine.map((id) => {
        const t = decor.tagsById.get(id);
        return t ? <TagChip key={id} name={t.name} color={t.color} onRemove={canEdit ? () => toggle(id, false) : undefined} /> : null;
      })}
      {mine.length === 0 && !canEdit && <span className="text-[14px] text-subtle">No tags</span>}
      {canEdit && (
        <Popover
          trigger={() => (
            <button
              type="button"
              disabled={pending}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed border-border-strong px-2 py-0.5 text-[13px] text-muted hover:border-primary hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" /> Tag
            </button>
          )}
          className="w-72"
        >
          <div className="max-h-56 overflow-y-auto">
            {decor.tags.length === 0 && <p className="px-2.5 py-2 text-[13px] text-subtle">No tags yet — create one below.</p>}
            {decor.tags.map((t) => {
              const on = mine.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id, !on)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] hover:bg-hover"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                  <span className="flex-1 truncate">{t.name}</span>
                  {on && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          </div>
          <form
            className="mt-1.5 border-t border-border px-1.5 pt-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim();
              if (!n) return;
              start(async () => {
                const r = await createTagAction(ctx.org.id, n, color);
                if (!r.ok) return void toast.error(r.message);
                const linked = await setTaskTagAction(ctx.org.id, task.id, r.tag.id, true);
                if (!linked.ok) toast.error(linked.message);
                setName("");
                onMetaChanged();
              });
            }}
          >
            <div className="mb-2 flex gap-1.5">
              {TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={cn("h-5 w-5 cursor-pointer rounded-full transition-transform", color === c && "scale-110 ring-2 ring-offset-2")}
                  style={{ backgroundColor: c, ["--tw-ring-color" as string]: c }}
                />
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="New tag name"
                aria-label="New tag name"
                className="h-8 min-w-0 flex-1 rounded-md border border-border px-2 text-[14px] outline-none focus:border-primary"
              />
              <button disabled={pending || !name.trim()} className="h-8 cursor-pointer rounded-md bg-primary px-2.5 text-[13px] font-medium text-white disabled:opacity-50">
                Create
              </button>
            </div>
          </form>
        </Popover>
      )}
    </div>
  );
}

/* --------------------------------- subtasks -------------------------------- */

export function SubtasksSection({ ctx, task, allTasks, decor, onOpenTask, onToggleDone, onCreated }: BreakdownProps) {
  const canEdit = can(ctx.role, "CREATE_OR_MOVE_TASK");
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  if (task.parentId) return null; // one level deep
  const children = Object.values(allTasks)
    .filter((t) => t.parentId === task.id)
    .sort((a, b) => a.taskNumber - b.taskNumber);
  const progress = decor.subtasks.get(task.id);
  const done = doneCol(ctx);

  return (
    <Section
      title={`Subtasks${progress ? ` · ${progress.done}/${progress.total}` : ""}`}
      icon={<GitBranch className="h-4 w-4 text-subtle" />}
    >
      {progress && <ProgressBar done={progress.done} total={progress.total} />}
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {children.map((c) => {
          const isDone = c.columnId === done;
          const assignee = c.assigneeId ? ctx.members.find((m) => m.id === c.assigneeId) : undefined;
          return (
            <div key={c.id} className="group flex items-center gap-3 px-3 py-2 hover:bg-[#fafafe]">
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => onToggleDone(c)}
                aria-label={isDone ? `Reopen ${c.title}` : `Complete ${c.title}`}
                className={cn(
                  "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 transition-colors disabled:cursor-default",
                  isDone ? "border-[#0f9d74] bg-[#0f9d74] text-white" : "border-border-strong hover:border-[#0f9d74]"
                )}
              >
                {isDone && <Check className="h-3 w-3" strokeWidth={3} />}
              </button>
              <button onClick={() => onOpenTask(c.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
                <span className="shrink-0 text-[13px] text-subtle">{refOf(ctx, c)}</span>
                <span className={cn("truncate text-[15px]", isDone && "text-muted line-through")}>{c.title}</span>
              </button>
              <PriorityFlag priority={c.priority} size={13} />
              {assignee && <Avatar id={assignee.id} name={assignee.name} src={assignee.avatarUrl} size={22} />}
            </div>
          );
        })}
        {children.length === 0 && <p className="px-3 py-2.5 text-[14px] text-subtle">No subtasks yet.</p>}
        {canEdit && (
          <form
            className="flex items-center gap-2 px-3 py-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const t = title.trim();
              if (!t) return;
              start(async () => {
                const r = await createTaskAction({ organizationId: ctx.org.id, columnId: ctx.columns[0]!.id, title: t, parentId: task.id });
                if (!r.ok) return void toast.error(r.message);
                onCreated([r.task]);
                setTitle("");
              });
            }}
          >
            <Plus className="h-4 w-4 shrink-0 text-subtle" />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
              maxLength={200}
              placeholder="Add a subtask and press Enter"
              aria-label="New subtask title"
              className="h-8 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
            />
          </form>
        )}
      </div>
    </Section>
  );
}

/* -------------------------------- checklist -------------------------------- */

export function ChecklistSection({ ctx, task, metaVersion, onMetaChanged }: BreakdownProps) {
  const canEdit = can(ctx.role, "CREATE_OR_MOVE_TASK");
  const [items, setItems] = useState<Item[] | null>(null);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    listChecklistAction(ctx.org.id, task.id).then((r) => alive && r.ok && setItems(r.items));
    return () => {
      alive = false;
    };
  }, [ctx.org.id, task.id, metaVersion]);

  const done = items?.filter((i) => i.done).length ?? 0;
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, optimistic?: (xs: Item[]) => Item[]) =>
    start(async () => {
      const before = items;
      if (optimistic && items) setItems(optimistic(items));
      const r = await fn();
      if (!r.ok) {
        setItems(before);
        return void toast.error(r.message ?? "Failed");
      }
      onMetaChanged();
    });

  return (
    <Section title={`Checklist${items?.length ? ` · ${done}/${items.length}` : ""}`} icon={<ListChecks className="h-4 w-4 text-subtle" />}>
      {!!items?.length && <ProgressBar done={done} total={items.length} />}
      <div className="space-y-0.5">
        {items?.map((i) => (
          <div key={i.id} className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => run(() => setChecklistItemDoneAction(ctx.org.id, i.id, !i.done), (xs) => xs.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))}
              aria-label={i.done ? `Uncheck ${i.text}` : `Check ${i.text}`}
              className={cn(
                "flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded border-2 transition-colors disabled:cursor-default",
                i.done ? "border-primary bg-primary text-white" : "border-border-strong hover:border-primary"
              )}
            >
              {i.done && <Check className="h-3 w-3" strokeWidth={3} />}
            </button>
            <span className={cn("flex-1 text-[15px]", i.done && "text-muted line-through")}>{i.text}</span>
            {canEdit && (
              <button
                type="button"
                onClick={() => run(() => deleteChecklistItemAction(ctx.org.id, i.id), (xs) => xs.filter((x) => x.id !== i.id))}
                aria-label={`Delete ${i.text}`}
                className="cursor-pointer rounded p-1 text-subtle opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {items && items.length === 0 && !canEdit && <p className="px-2 text-[14px] text-subtle">No checklist items.</p>}
      </div>
      {canEdit && (
        <form
          className="mt-1 flex items-center gap-3 px-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            start(async () => {
              const r = await addChecklistItemAction(ctx.org.id, task.id, t);
              if (!r.ok) return void toast.error(r.message);
              setItems((xs) => [...(xs ?? []), r.item]);
              setText("");
              onMetaChanged();
            });
          }}
        >
          <Plus className="h-4 w-4 shrink-0 text-subtle" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={pending}
            maxLength={300}
            placeholder="Add an item and press Enter"
            aria-label="New checklist item"
            className="h-8 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
          />
        </form>
      )}
    </Section>
  );
}

/* ------------------------------- dependencies ------------------------------ */

export function DependenciesSection({ ctx, task, allTasks, decor, onOpenTask, onMetaChanged }: BreakdownProps) {
  const canEdit = can(ctx.role, "CREATE_OR_MOVE_TASK");
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"blockedBy" | "blocking">("blockedBy");
  const [q, setQ] = useState("");
  const done = doneCol(ctx);

  const blockedBy = decor.deps.filter((d) => d.blockedId === task.id).map((d) => allTasks[d.blockerId]).filter(Boolean) as TaskDTO[];
  const blocking = decor.deps.filter((d) => d.blockerId === task.id).map((d) => allTasks[d.blockedId]).filter(Boolean) as TaskDTO[];
  const linked = new Set([task.id, ...blockedBy.map((t) => t.id), ...blocking.map((t) => t.id)]);
  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    return Object.values(allTasks)
      .filter((t) => !linked.has(t.id))
      .filter((t) => !term || t.title.toLowerCase().includes(term) || refOf(ctx, t).toLowerCase().includes(term))
      .sort((a, b) => a.taskNumber - b.taskNumber)
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTasks, q, blockedBy.length, blocking.length]);

  const add = (other: string) =>
    start(async () => {
      const [blocker, blocked] = mode === "blockedBy" ? [other, task.id] : [task.id, other];
      const r = await addDependencyAction(ctx.org.id, blocker, blocked);
      if (!r.ok) return void toast.error(r.message);
      setQ("");
      onMetaChanged();
    });
  const remove = (blocker: string, blocked: string) =>
    start(async () => {
      const r = await removeDependencyAction(ctx.org.id, blocker, blocked);
      if (!r.ok) return void toast.error(r.message);
      onMetaChanged();
    });

  const Row = ({ t, onRemove }: { t: TaskDTO; onRemove: () => void }) => {
    const isDone = t.columnId === done;
    return (
      <div className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", isDone ? "bg-[#0f9d74]" : "bg-red-500")} title={isDone ? "Done" : "Open"} />
        <button onClick={() => onOpenTask(t.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
          <span className="shrink-0 text-[13px] text-subtle">{refOf(ctx, t)}</span>
          <span className={cn("truncate text-[15px]", isDone && "text-muted line-through")}>{t.title}</span>
        </button>
        {canEdit && (
          <button onClick={onRemove} aria-label={`Remove link to ${t.title}`} className="cursor-pointer rounded p-1 text-subtle opacity-0 hover:text-red-600 group-hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };

  const openBlockers = decor.openBlockers.get(task.id)?.length ?? 0;
  return (
    <Section title="Dependencies" icon={<Link2 className="h-4 w-4 text-subtle" />}>
      {openBlockers > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-700">
          <Ban className="h-4 w-4" /> Blocked by {openBlockers} unfinished task{openBlockers === 1 ? "" : "s"}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 px-2 text-[13px] font-semibold text-subtle">Blocked by</div>
          {blockedBy.length ? blockedBy.map((t) => <Row key={t.id} t={t} onRemove={() => remove(t.id, task.id)} />) : <p className="px-2 text-[14px] text-subtle">Nothing</p>}
        </div>
        <div>
          <div className="mb-1 px-2 text-[13px] font-semibold text-subtle">Blocking</div>
          {blocking.length ? blocking.map((t) => <Row key={t.id} t={t} onRemove={() => remove(task.id, t.id)} />) : <p className="px-2 text-[14px] text-subtle">Nothing</p>}
        </div>
      </div>
      {canEdit && (
        <div className="mt-3 rounded-lg border border-border p-2">
          <div className="mb-2 flex gap-1 rounded-md bg-surface-2 p-0.5">
            {(
              [
                ["blockedBy", "This is blocked by…"],
                ["blocking", "This blocks…"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn("flex-1 cursor-pointer rounded px-2 py-1 text-[13px] font-medium", mode === m ? "bg-white text-foreground shadow-card" : "text-muted")}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tasks to link"
              aria-label="Search tasks to link"
              className="h-9 w-full rounded-md border border-border pl-8 pr-2 text-[14px] outline-none focus:border-primary"
            />
          </label>
          <div className="mt-1 max-h-44 overflow-y-auto">
            {candidates.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={pending}
                onClick={() => add(t.id)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-hover"
              >
                <span className="shrink-0 text-[13px] text-subtle">{refOf(ctx, t)}</span>
                <span className="truncate">{t.title}</span>
              </button>
            ))}
            {candidates.length === 0 && <p className="px-2 py-1.5 text-[13px] text-subtle">No matching tasks</p>}
          </div>
        </div>
      )}
    </Section>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mb-2.5 flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-[#0f9d74] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[13px] font-semibold tabular-nums text-muted">{pct}%</span>
    </div>
  );
}
