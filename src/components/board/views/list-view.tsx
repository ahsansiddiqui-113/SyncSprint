"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { timeAgo, cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { PRIORITY_STYLE, PriorityFlag, StatusPill } from "@/components/ui/badge";
import { groupByColumn } from "../board-state";
import { BreakdownBadges, DueChip, ParentRef, PointsBadge, TypeIcon } from "../task-meta";
import type { ViewProps } from "./types";

const GRID = "grid grid-cols-[minmax(0,1fr)_160px_120px_120px_70px_100px_100px]";

/** ClickUp-style list: one collapsible group per status, spreadsheet-like rows. */
export function ListView(props: ViewProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => groupByColumn(props.tasks, props.columns.map((c) => c.id)), [props.tasks, props.columns]);

  return (
    <div className="flex-1 overflow-auto bg-white px-8 py-6">
      <div className="min-w-[960px] space-y-7">
        {props.columns.map((col, i) => {
          const ids = grouped[col.id] ?? [];
          const color = props.colorOf(i);
          const isCollapsed = collapsed[col.id];
          const done = col.id === props.doneColumnId;
          const points = ids.reduce((s, id) => s + (props.tasks[id]?.storyPoints ?? 0), 0);
          return (
            <section key={col.id}>
              <div className="mb-2 flex items-center gap-2">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [col.id]: !c[col.id] }))}
                  className="cursor-pointer rounded p-0.5 text-subtle hover:bg-hover"
                  aria-label={isCollapsed ? "Expand group" : "Collapse group"}
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isCollapsed && "-rotate-90")} />
                </button>
                <StatusPill title={col.title} color={color} count={ids.length} />
                {points > 0 && <span className="text-[13px] text-subtle">· {points} pts</span>}
              </div>
              {!isCollapsed && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className={cn(GRID, "border-b border-border bg-surface-2 px-4 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-subtle")}>
                    <span>Name</span>
                    <span>Assignee</span>
                    <span>Due date</span>
                    <span>Priority</span>
                    <span>Pts</span>
                    <span>ID</span>
                    <span>Updated</span>
                  </div>
                  {ids.map((id) => {
                    const t = props.tasks[id];
                    if (!t) return null;
                    const assignee = t.assigneeId ? props.memberById.get(t.assigneeId) : undefined;
                    const viewers = props.presenceByTask.get(id) ?? [];
                    return (
                      <button
                        key={id}
                        onClick={() => props.onOpen(id)}
                        className={cn(
                          GRID,
                          "w-full cursor-pointer items-center border-b border-border px-4 py-3 text-left text-[15px] transition-colors last:border-0 hover:bg-[#fafafe]",
                          props.flash[id] && "animate-flash"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2" style={{ borderColor: color, backgroundColor: done ? color : "transparent" }} />
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
                              <Avatar id={assignee.id} name={assignee.name} src={assignee.avatarUrl} size={24} />
                              <span className="truncate">{assignee.name.split(" ")[0]}</span>
                            </>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </span>
                        <span>{t.dueDate ? <DueChip due={t.dueDate} done={done} /> : <span className="text-[14px] text-subtle">—</span>}</span>
                        <span className="flex items-center gap-1.5 text-[14px] text-muted">
                          <PriorityFlag priority={t.priority} /> {PRIORITY_STYLE[t.priority].label}
                        </span>
                        <span>{t.storyPoints !== null ? <PointsBadge points={t.storyPoints} /> : <span className="text-[14px] text-subtle">—</span>}</span>
                        <span className="text-[14px] text-subtle">{props.refOf(t)}</span>
                        <span className="text-[14px] text-subtle">{timeAgo(t.updatedAt)}</span>
                      </button>
                    );
                  })}
                  {ids.length === 0 && <div className="px-4 py-3 text-[14px] text-subtle">No tasks</div>}
                  {props.canEdit && (
                    <button
                      onClick={() => props.onAdd({ columnId: col.id })}
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
