"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { TaskDTO } from "@/lib/realtime-protocol";
import type { ProjectMeta } from "@/server/services/breakdown";
import type { SprintDTO } from "@/server/services/sprints";
import { timeAgo, cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { PRIORITY_STYLE, PriorityFlag, StatusPill } from "@/components/ui/badge";
import { BreakdownBadges, DueChip, ParentRef, PointsBadge, TYPE_META, TypeIcon, WORK_ITEM_TYPES } from "../task-meta";
import type { GroupBy } from "../views-menu";
import { sortTasks, type SortState } from "./table-view";
import type { ViewProps } from "./types";

const GRID = "grid grid-cols-[minmax(0,1fr)_170px_120px_120px_80px_64px_92px_100px]";
const NEUTRAL = "#7a8290";

type Group = { id: string; label: string; color: string; tasks: TaskDTO[]; addColumnId?: string; icon?: React.ReactNode };

/** ClickUp-style list: collapsible groups (status by default), spreadsheet-like rows. */
export function ListView(props: ViewProps & { groupBy: GroupBy; sort: SortState; sprints: SprintDTO[]; meta: ProjectMeta }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const columnIndex = useMemo(() => new Map(props.columns.map((c, i) => [c.id, i])), [props.columns]);

  const groups = useMemo<Group[]>(() => {
    // Default order follows the board (fractional position); an explicit sort overrides it.
    const base = Object.values(props.tasks).sort((a, b) => (columnIndex.get(a.columnId) ?? 0) - (columnIndex.get(b.columnId) ?? 0) || a.position - b.position);
    const list = sortTasks(base, props.sort, {
      columnIndex,
      memberName: (id) => (id ? (props.memberById.get(id)?.name ?? "") : ""),
      meta: props.meta,
    });
    const by = <K extends string>(key: (t: TaskDTO) => K, defs: { id: K; label: string; color: string; addColumnId?: string; icon?: React.ReactNode }[]): Group[] =>
      defs.map((d) => ({ ...d, tasks: list.filter((t) => key(t) === d.id) }));

    switch (props.groupBy) {
      case "assignee":
        return by((t) => t.assigneeId ?? "__none", [
          ...[...props.memberById.values()].map((m) => ({ id: m.id, label: m.name, color: NEUTRAL, icon: <Avatar id={m.id} name={m.name} src={m.avatarUrl} size={22} /> })),
          { id: "__none", label: "Unassigned", color: NEUTRAL },
        ]).filter((g) => g.tasks.length);
      case "priority":
        return by((t) => t.priority, (["urgent", "high", "medium", "low"] as const).map((p) => ({ id: p, label: PRIORITY_STYLE[p].label, color: NEUTRAL, icon: <PriorityFlag priority={p} /> })));
      case "type":
        return by((t) => t.type, WORK_ITEM_TYPES.map((x) => ({ id: x, label: TYPE_META[x].label, color: NEUTRAL, icon: <TypeIcon type={x} size={18} /> })));
      case "sprint":
        return by((t) => t.sprintId ?? "__backlog", [
          ...props.sprints.filter((s) => s.status !== "completed").map((s) => ({ id: s.id, label: s.status === "active" ? `${s.name} (active)` : s.name, color: NEUTRAL })),
          { id: "__backlog", label: "Backlog", color: NEUTRAL },
        ]).filter((g) => g.tasks.length || g.id !== "__backlog");
      default:
        return props.columns.map((c, i) => ({ id: c.id, label: c.title, color: props.colorOf(i), addColumnId: c.id, tasks: list.filter((t) => t.columnId === c.id) }));
    }
  }, [props.tasks, props.groupBy, props.sort, props.columns, props.memberById, props.sprints, props.meta, columnIndex, props]);

  return (
    <div className="flex-1 overflow-auto bg-white px-8 py-6">
      <div className="min-w-[1040px] space-y-7">
        {groups.map((g) => {
          const isCollapsed = collapsed[g.id];
          const points = g.tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
          const hours = g.tasks.reduce((s, t) => s + (t.estimateHours ?? 0), 0);
          return (
            <section key={g.id}>
              <div className="mb-2 flex items-center gap-2">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
                  className="cursor-pointer rounded p-0.5 text-subtle hover:bg-hover"
                  aria-label={isCollapsed ? "Expand group" : "Collapse group"}
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")} />
                </button>
                {props.groupBy === "status" ? (
                  <StatusPill title={g.label} color={g.color} count={g.tasks.length} />
                ) : (
                  <span className="inline-flex items-center gap-2 text-[15px] font-semibold">
                    {g.icon}
                    {g.label}
                    <span className="text-[14px] font-medium text-subtle">{g.tasks.length}</span>
                  </span>
                )}
                {points > 0 && <span className="text-[13px] text-subtle">· {points} pts</span>}
                {hours > 0 && <span className="text-[13px] text-subtle">· {Math.round(hours * 10) / 10}h</span>}
              </div>
              {!isCollapsed && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className={cn(GRID, "border-b border-border bg-surface-2 px-4 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-subtle")}>
                    <span>Name</span>
                    <span>Assignee</span>
                    <span>Due date</span>
                    <span>Priority</span>
                    <span>Estimate</span>
                    <span>Pts</span>
                    <span>ID</span>
                    <span>Updated</span>
                  </div>
                  {g.tasks.map((t) => {
                    const ci = columnIndex.get(t.columnId) ?? 0;
                    const color = props.colorOf(ci);
                    const done = t.columnId === props.doneColumnId;
                    const assignee = t.assigneeId ? props.memberById.get(t.assigneeId) : undefined;
                    const co = (props.meta.coAssignees[t.id] ?? []).map((id) => props.memberById.get(id)).filter(Boolean);
                    const viewers = props.presenceByTask.get(t.id) ?? [];
                    return (
                      <button
                        key={t.id}
                        onClick={() => props.onOpen(t.id)}
                        className={cn(
                          GRID,
                          "w-full cursor-pointer items-center border-b border-border px-4 py-3 text-left text-[15px] transition-colors last:border-0 hover:bg-[#fafafe]",
                          props.flash[t.id] && "animate-flash"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span title={props.columns[ci]?.title} className="h-3.5 w-3.5 shrink-0 rounded-full border-2" style={{ borderColor: color, backgroundColor: done ? color : "transparent" }} />
                          <TypeIcon type={t.type} size={17} />
                          <span className="flex min-w-0 flex-col">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className={cn("truncate font-medium", done && "text-muted line-through decoration-black/25")}>{t.title}</span>
                              <BreakdownBadges taskId={t.id} decor={props.decor} maxTags={2} className="shrink-0 flex-nowrap" />
                            </span>
                            {t.parentId && props.allTasks[t.parentId] && (
                              <ParentRef parent={props.allTasks[t.parentId]} refLabel={props.refOf(props.allTasks[t.parentId]!)} />
                            )}
                          </span>
                          {viewers.length > 0 && (
                            <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-semibold text-primary">
                              {viewers[0]!.name.split(" ")[0]} {viewers.some((v) => v.editing) ? "editing…" : "viewing"}
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2 text-[14px] text-muted">
                          {assignee ? (
                            <>
                              <span className="flex -space-x-1.5">
                                <Avatar id={assignee.id} name={assignee.name} src={assignee.avatarUrl} size={24} ring />
                                {co.slice(0, 2).map((m) => <Avatar key={m!.id} id={m!.id} name={m!.name} src={m!.avatarUrl} size={24} ring />)}
                              </span>
                              <span className="truncate">{assignee.name.split(" ")[0]}{co.length ? ` +${co.length}` : ""}</span>
                            </>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </span>
                        <span>{t.dueDate ? <DueChip due={t.dueDate} done={done} /> : <span className="text-[14px] text-subtle">—</span>}</span>
                        <span className="flex items-center gap-1.5 text-[14px] text-muted">
                          <PriorityFlag priority={t.priority} /> {PRIORITY_STYLE[t.priority].label}
                        </span>
                        <span className="text-[14px] tabular-nums text-muted">{t.estimateHours !== null ? `${t.estimateHours}h` : "—"}</span>
                        <span>{t.storyPoints !== null ? <PointsBadge points={t.storyPoints} /> : <span className="text-[14px] text-subtle">—</span>}</span>
                        <span className="text-[14px] text-subtle">{props.refOf(t)}</span>
                        <span className="text-[14px] text-subtle">{timeAgo(t.updatedAt)}</span>
                      </button>
                    );
                  })}
                  {g.tasks.length === 0 && <div className="px-4 py-3 text-[14px] text-subtle">No tasks</div>}
                  {props.canEdit && g.addColumnId && (
                    <button
                      onClick={() => props.onAdd({ columnId: g.addColumnId })}
                      className="flex w-full cursor-pointer items-center gap-2 border-t border-border px-4 py-2.5 text-left text-[14px] font-medium text-subtle transition-colors hover:bg-hover hover:text-foreground"
                    >
                      <Plus className="h-4 w-4" /> Add Task
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
