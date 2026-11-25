"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Bell, BellOff, Check, Plus, X } from "lucide-react";
import type { TaskDTO } from "@/lib/realtime-protocol";
import type { CapacityWarning } from "@/server/services/capacity";
import { setCoAssigneesAction, setWatchingAction } from "@/actions/customize.actions";
import { can } from "@/lib/rbac-shared";
import { cn } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import { Avatar } from "@/components/ui/avatar";
import { Popover } from "@/components/ui/popover";
import type { WeekLoad } from "./views/table-view";
import type { BoardCtx } from "./kanban-board";

/** Watch / unwatch (anyone in the workspace, viewers included). */
export function WatchButton({ ctx, task, watchers, onChanged }: { ctx: BoardCtx; task: TaskDTO; watchers: string[]; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const watching = watchers.includes(ctx.me.id);
  const others = watchers.filter((w) => w !== ctx.me.id).length;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setWatchingAction(ctx.org.id, task.id, !watching);
          if (!r.ok) return void toast.error(r.message);
          onChanged();
        })
      }
      title={watching ? "Stop watching this task" : "Watch this task"}
      className={cn(
        "ml-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-medium transition-colors",
        watching ? "border-primary/40 bg-primary-soft text-primary" : "border-border text-muted hover:bg-hover"
      )}
    >
      {watching ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
      {watching ? "Watching" : "Watch"}
      {watchers.length > 0 && <span className="text-subtle">· {watching ? (others ? `you + ${others}` : "you") : watchers.length}</span>}
    </button>
  );
}

/** Co-assignees: chips + a picker that shows each person's load this week. */
export function CoAssignees({
  ctx,
  task,
  primary,
  current,
  weekLoad,
  disabled,
  onChanged,
  onWarnings,
}: {
  ctx: BoardCtx;
  task: TaskDTO;
  primary: string | null;
  current: string[];
  weekLoad: WeekLoad;
  disabled: boolean;
  onChanged: () => void;
  onWarnings: (w: CapacityWarning[] | undefined) => void;
}) {
  const [pending, start] = useTransition();
  const save = (ids: string[]) =>
    start(async () => {
      const r = await setCoAssigneesAction(ctx.org.id, task.id, ids, todayISO());
      if (!r.ok) return void toast.error(r.message);
      onChanged();
      onWarnings(r.warnings);
    });
  const people = current.map((id) => ctx.members.find((m) => m.id === id)).filter(Boolean) as BoardCtx["members"];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {people.map((m) => (
        <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2 text-[13.5px]">
          <Avatar id={m.id} name={m.name} src={m.avatarUrl} size={20} />
          {m.name.split(" ")[0]}
          {!disabled && (
            <button type="button" aria-label={`Unassign ${m.name}`} disabled={pending} onClick={() => save(current.filter((x) => x !== m.id))} className="cursor-pointer text-subtle hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ))}
      {people.length === 0 && disabled && <span className="text-[14px] text-subtle">Nobody else</span>}
      {!disabled && can(ctx.role, "CREATE_OR_MOVE_TASK") && (
        <Popover
          className="w-80"
          trigger={() => (
            <button type="button" className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-border-strong px-2 py-0.5 text-[13px] text-muted hover:border-primary hover:text-primary">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          )}
        >
          {ctx.members
            .filter((m) => m.id !== primary)
            .map((m) => {
              const on = current.includes(m.id);
              const l = weekLoad.get(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={pending}
                  onClick={() => save(on ? current.filter((x) => x !== m.id) : [...current, m.id])}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[14px] hover:bg-hover"
                >
                  <Avatar id={m.id} name={m.name} src={m.avatarUrl} size={22} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  {l && l.capacity > 0 && (
                    <span className={cn("shrink-0 text-[12px] tabular-nums", l.status === "over" ? "font-semibold text-red-600" : l.status === "near" ? "text-amber-700" : "text-subtle")}>
                      {l.status === "over" && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}
                      {Math.round(l.load)}/{l.capacity}h
                    </span>
                  )}
                  {on && <Check className="h-4 w-4 text-primary" />}
                </button>
              );
            })}
          <p className="px-2.5 pb-1 pt-2 text-[12px] text-subtle">Hours show this week&apos;s load. The estimate is split evenly between everyone assigned.</p>
        </Popover>
      )}
    </div>
  );
}

/**
 * Pre-save heads-up in the drawer: what this week would look like for the chosen
 * assignee with the (unsaved) estimate. Never blocks saving.
 */
export function CapacityNote({
  ctx,
  assigneeId,
  draftEstimate,
  savedEstimate,
  savedAssignee,
  weekLoad,
}: {
  ctx: BoardCtx;
  assigneeId: string;
  draftEstimate: number;
  savedEstimate: number;
  savedAssignee: string | null;
  weekLoad: WeekLoad;
}) {
  if (!assigneeId) return null;
  const l = weekLoad.get(assigneeId);
  if (!l || l.capacity <= 0) return null;
  // Current load already includes the saved estimate if this person already owns the task.
  const projected = l.load + draftEstimate - (savedAssignee === assigneeId ? savedEstimate : 0);
  const over = projected > l.capacity;
  const near = !over && projected >= l.capacity * 0.85;
  if (!over && !near) return null;
  const name = ctx.members.find((m) => m.id === assigneeId)?.name.split(" ")[0] ?? "They";
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12.5px] font-medium",
        over ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      {name}: {Math.round(projected * 10) / 10}h of {l.capacity}h this week{over ? " — over capacity" : ""}
    </span>
  );
}
