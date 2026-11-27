"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, AlignLeft, ChevronDown, Plus, Rows3, Timer, UserRound } from "lucide-react";
import type { PresenceUser, TaskDTO } from "@/lib/realtime-protocol";
import { positionForIndex } from "@/lib/fractional-index";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { PRIORITY_STYLE, PriorityFlag, StatusPill } from "@/components/ui/badge";
import { groupByColumn } from "../board-state";
import { BreakdownBadges, DueChip, ParentRef, PointsBadge, TypeIcon } from "../task-meta";
import type { TaskDecor } from "../decor";
import type { Column, Member } from "../kanban-board";
import type { TaskPatch, ViewProps } from "./types";

/** Swimlanes (Azure Boards / ClickUp style): rows by assignee, priority or work item type. */
export type LaneBy = "none" | "assignee" | "priority" | "type";
const LANE_SEP = "|";
const PRIORITY_LANES = ["urgent", "high", "medium", "low"] as const;
const TYPE_LANES = ["epic", "story", "task", "bug"] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Kanban board. Drag state is local; the parent's `onMove` owns the optimistic
 * update, server call, conflict rollback and explanation.
 */
export function BoardView(props: ViewProps & {
  projectId: string;
  onMove: (task: TaskDTO, columnId: string, position: number, lanePatch?: TaskPatch) => void;
}) {
  const { tasks, columns } = props;
  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const [dragItems, setDragItems] = useState<Record<string, string[]> | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [laneBy, setLaneBy] = useState<LaneBy>("none");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const storeKey = `ss:lanes:${props.projectId}`;
  useEffect(() => {
    try {
      const v = localStorage.getItem(storeKey) as LaneBy | null;
      if (v && ["none", "assignee", "priority", "type"].includes(v)) setLaneBy(v);
    } catch {}
  }, [storeKey]);
  const chooseLanes = (v: LaneBy) => {
    setLaneBy(v);
    try { localStorage.setItem(storeKey, v); } catch {}
  };

  const laneOf = (t: TaskDTO) => (laneBy === "assignee" ? (t.assigneeId ?? "none") : laneBy === "priority" ? t.priority : laneBy === "type" ? t.type : "all");
  const lanes = useMemo(() => {
    if (laneBy === "priority") return PRIORITY_LANES.map((k) => ({ key: k as string, label: cap(k) }));
    if (laneBy === "type") return TYPE_LANES.map((k) => ({ key: k as string, label: cap(k) }));
    if (laneBy === "assignee") {
      const used = new Set(Object.values(tasks).map((t) => t.assigneeId ?? "none"));
      const people = [...props.memberById.values()].filter((m) => used.has(m.id)).sort((a, b) => a.name.localeCompare(b.name));
      return [...people.map((m) => ({ key: m.id, label: m.name })), { key: "none", label: "Unassigned" }];
    }
    return [{ key: "all", label: "" }];
  }, [laneBy, tasks, props.memberById]);
  const lanePatch = (key: string): TaskPatch =>
    laneBy === "assignee" ? { assigneeId: key === "none" ? null : key } : laneBy === "priority" ? { priority: key as TaskDTO["priority"] } : laneBy === "type" ? { type: key as TaskDTO["type"] } : {};
  const containerOf = (lane: string, col: string) => (laneBy === "none" ? col : `${lane}${LANE_SEP}${col}`);
  const splitContainer = (c: string) => (laneBy === "none" ? { lane: "all", col: c } : { lane: c.slice(0, c.lastIndexOf(LANE_SEP)), col: c.slice(c.lastIndexOf(LANE_SEP) + 1) });
  const groupAll = () => {
    const byCol = groupByColumn(tasks, columnIds);
    if (laneBy === "none") return byCol;
    const out: Record<string, string[]> = {};
    for (const l of lanes) for (const c of columnIds) out[containerOf(l.key, c)] = [];
    for (const c of columnIds) for (const id of byCol[c] ?? []) (out[containerOf(laneOf(tasks[id]!), c)] ??= []).push(id);
    return out;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grouped = useMemo(() => dragItems ?? groupAll(), [dragItems, tasks, columnIds, laneBy, lanes]);
  const colTotals = useMemo(() => groupByColumn(tasks, columnIds), [tasks, columnIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const findContainer = (items: Record<string, string[]>, id: string) =>
    id in items ? id : Object.keys(items).find((c) => items[c]!.includes(id));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setDragItems(groupAll());
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over || !dragItems) return;
    const a = String(active.id);
    const o = String(over.id);
    const from = findContainer(dragItems, a);
    const to = findContainer(dragItems, o);
    if (!from || !to || from === to) return;
    setDragItems((items) => {
      if (!items) return items;
      const target = items[to]!;
      const overIndex = target.indexOf(o);
      const index = overIndex >= 0 ? overIndex : target.length;
      return { ...items, [from]: items[from]!.filter((id) => id !== a), [to]: [...target.slice(0, index), a, ...target.slice(index)] };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const items = dragItems;
    setDragItems(null);
    setActiveId(null);
    if (!over || !items) return;
    const taskId = String(active.id);
    const task = tasks[taskId];
    const toContainer = findContainer(items, String(over.id));
    if (!task || !toContainer) return;
    const { lane: toLane, col: toCol } = splitContainer(toContainer);

    let list = items[toContainer]!;
    const oldIdx = list.indexOf(taskId);
    const overIdx = list.indexOf(String(over.id));
    if (overIdx >= 0 && oldIdx !== overIdx) list = arrayMove(list, oldIdx, overIdx);
    const index = list.indexOf(taskId);

    const laneChanged = laneBy !== "none" && laneOf(task) !== toLane;
    const before = groupAll();
    if (!laneChanged && task.columnId === toCol && before[toContainer]!.indexOf(taskId) === index) return; // dropped in place

    // WIP limit: warn (never block) when this drop pushes a status over its limit.
    const col = columns.find((c) => c.id === toCol);
    const inCol = (colTotals[toCol] ?? []).filter((id) => id !== taskId).length + 1;
    if (col?.wipLimit && task.columnId !== toCol && inCol > col.wipLimit) {
      toast.warning(`${col.title} is over its work-in-progress limit (${inCol}/${col.wipLimit}). Finish something before starting more.`);
    }
    const neighbours = list.filter((id) => id !== taskId).map((id) => tasks[id]!.position);
    props.onMove(task, toCol, positionForIndex(neighbours, index).position, laneChanged ? lanePatch(toLane) : undefined);
  }

  const activeTask = activeId ? tasks[activeId] : null;
  const parentOf = (t: TaskDTO) => {
    const p = t.parentId ? props.allTasks[t.parentId] : undefined;
    return p ? { ref: props.refOf(p), title: p.title } : undefined;
  };
  return (
    <DndContext
      id={`board-${props.projectId}`}
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragItems(null);
        setActiveId(null);
      }}
    >
      <div className="flex items-center gap-2 bg-canvas px-8 pt-4 text-[13.5px] text-muted">
        <Rows3 className="h-4 w-4" /> Swimlanes
        <div className="flex rounded-lg border border-border bg-white p-0.5" role="radiogroup" aria-label="Swimlanes">
          {(["none", "assignee", "priority", "type"] as const).map((v) => (
            <button key={v} role="radio" aria-checked={laneBy === v} onClick={() => chooseLanes(v)}
              className={cn("cursor-pointer rounded-md px-2.5 py-1 font-medium", laneBy === v ? "bg-primary-soft text-primary" : "hover:text-foreground")}>
              {v === "none" ? "None" : cap(v)}
            </button>
          ))}
        </div>
        {laneBy !== "none" && <span className="text-[12.5px] text-subtle">Drag a card to another row to change its {laneBy}.</span>}
      </div>
      {laneBy !== "none" ? (
        <div className="flex-1 overflow-auto bg-canvas px-8 pb-6 pt-3">
          <div className="sticky top-0 z-10 flex gap-3 bg-canvas pb-2">
            {columns.map((col, i) => (
              <div key={col.id} className="flex min-w-[260px] flex-1 basis-0 items-center gap-2 px-1">
                <StatusPill title={col.title} color={props.colorOf(i)} count={colTotals[col.id]?.length ?? 0} />
                <WipBadge count={colTotals[col.id]?.length ?? 0} limit={col.wipLimit} />
              </div>
            ))}
          </div>
          {lanes.map((lane) => {
            const total = columns.reduce((n, c) => n + (grouped[containerOf(lane.key, c.id)]?.length ?? 0), 0);
            return (
              <section key={lane.key} className="mb-3 rounded-xl border border-border bg-white/60" aria-label={`${lane.label} lane`}>
                <button onClick={() => setCollapsed((c) => ({ ...c, [lane.key]: !c[lane.key] }))} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[14px] font-semibold">
                  <ChevronDown className={cn("h-4 w-4 text-subtle transition-transform", collapsed[lane.key] && "-rotate-90")} />
                  {laneBy === "assignee" && lane.key !== "none" ? <Avatar id={lane.key} name={lane.label} src={props.memberById.get(lane.key)?.avatarUrl ?? null} size={22} /> : null}
                  {lane.label} <span className="font-normal text-subtle">{total}</span>
                </button>
                {!collapsed[lane.key] && (
                  <div className="flex gap-3 px-2 pb-2">
                    {columns.map((col, i) => {
                      const cid = containerOf(lane.key, col.id);
                      return (
                        <LaneCell key={cid} id={cid} color={props.colorOf(i)}>
                          <SortableContext items={grouped[cid] ?? []} strategy={verticalListSortingStrategy}>
                            {(grouped[cid] ?? []).map((id) => {
                              const t = tasks[id];
                              if (!t) return null;
                              return (
                                <SortableCard key={id} task={t} refLabel={props.refOf(t)} disabled={!props.canEdit} done={col.id === props.doneColumnId}
                                  assignee={t.assigneeId ? props.memberById.get(t.assigneeId) : undefined} viewers={props.presenceByTask.get(id) ?? []}
                                  flash={!!props.flash[id]} onOpen={() => props.onOpen(id)} decor={props.decor} parent={parentOf(t)} />
                              );
                            })}
                          </SortableContext>
                        </LaneCell>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
      <div className="flex flex-1 gap-4 overflow-x-auto bg-canvas px-8 py-6">
        {columns.map((col, i) => (
          <BoardColumn
            key={col.id}
            column={col}
            color={props.colorOf(i)}
            count={grouped[col.id]?.length ?? 0}
            canAdd={props.canEdit}
            onAdd={() => props.onAdd({ columnId: col.id })}
          >
            <SortableContext items={grouped[col.id] ?? []} strategy={verticalListSortingStrategy}>
              {(grouped[col.id] ?? []).map((id) => {
                const t = tasks[id];
                if (!t) return null;
                return (
                  <SortableCard
                    key={id}
                    task={t}
                    refLabel={props.refOf(t)}
                    disabled={!props.canEdit}
                    done={col.id === props.doneColumnId}
                    assignee={t.assigneeId ? props.memberById.get(t.assigneeId) : undefined}
                    viewers={props.presenceByTask.get(id) ?? []}
                    flash={!!props.flash[id]}
                    onOpen={() => props.onOpen(id)}
                    decor={props.decor}
                    parent={parentOf(t)}
                  />
                );
              })}
            </SortableContext>
          </BoardColumn>
        ))}
      </div>
      )}
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
        {activeTask && (
          <CardBody
            task={activeTask}
            refLabel={props.refOf(activeTask)}
            assignee={activeTask.assigneeId ? props.memberById.get(activeTask.assigneeId) : undefined}
            viewers={[]}
            done={activeTask.columnId === props.doneColumnId}
            decor={props.decor}
            parent={parentOf(activeTask)}
            className="rotate-[2deg] cursor-grabbing shadow-glow"
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  column,
  color,
  count,
  canAdd,
  onAdd,
  children,
}: {
  column: Column;
  color: string;
  count: number;
  canAdd: boolean;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={column.title}
      className={cn("flex min-w-[290px] flex-1 basis-0 flex-col rounded-xl transition-shadow duration-150", isOver && "shadow-[0_0_0_2px_var(--color-primary)]")}
      style={{ backgroundColor: `${color}12` }}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <StatusPill title={column.title} color={color} count={count} />
        <WipBadge count={count} limit={column.wipLimit} />
        {canAdd && (
          <button onClick={onAdd} title={`Add task to ${column.title}`} className="ml-auto cursor-pointer rounded-md p-1 text-subtle transition-colors hover:bg-white hover:text-foreground">
            <Plus className="h-4 w-4" />
          </button>
        )}
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {children}
        {count === 0 && (
          <div className="flex items-center justify-center rounded-lg border-2 border-dashed py-8 text-[14px] text-subtle" style={{ borderColor: `${color}40` }}>
            Drop tasks here
          </div>
        )}
        {canAdd && (
          <button
            onClick={onAdd}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 text-left text-[14px] font-medium text-muted transition-colors hover:bg-white hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> Add Task
          </button>
        )}
      </div>
    </section>
  );
}

function SortableCard(props: {
  task: TaskDTO;
  refLabel: string;
  decor: TaskDecor;
  parent?: { ref: string; title: string };
  disabled: boolean;
  done: boolean;
  assignee?: Member;
  viewers: PresenceUser[];
  flash: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id, disabled: props.disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter") props.onOpen();
      }}
      aria-label={`${props.refLabel} ${props.task.title}`}
      className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {isDragging ? (
        <div className="h-[112px] rounded-lg border-2 border-dashed border-primary/40 bg-primary-soft" />
      ) : (
        <CardBody {...props} className={cn(props.flash && "animate-flash", !props.disabled && "cursor-grab active:cursor-grabbing")} />
      )}
    </div>
  );
}

export function CardBody({
  task,
  refLabel,
  assignee,
  viewers,
  done,
  className,
  decor,
  parent,
}: {
  task: TaskDTO;
  refLabel: string;
  decor?: TaskDecor;
  parent?: { ref: string; title: string };
  assignee?: Member;
  viewers: PresenceUser[];
  done?: boolean;
  className?: string;
}) {
  const editor = viewers.find((v) => v.editing);
  const someone = editor ?? viewers[0];
  return (
    <article
      className={cn(
        "group relative rounded-lg border border-border bg-white p-3.5 shadow-card transition-all duration-150 hover:border-border-strong hover:shadow-lift",
        someone && "border-primary/50 ring-2 ring-primary/15",
        className
      )}
    >
      <div className="flex items-center gap-2 text-[13px] text-subtle">
        <TypeIcon type={task.type} size={16} />
        <span className="font-medium">{refLabel}</span>
        {task.description && <AlignLeft className="h-3.5 w-3.5" />}
        {someone && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-semibold text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {someone.name.split(" ")[0]} {editor ? "editing…" : "viewing"}
          </span>
        )}
      </div>
      {parent && <ParentRef parent={parent} refLabel={parent.ref} className="mt-1 w-full" />}
      <p className={cn("mt-1.5 text-[16px] font-medium leading-snug text-foreground", done && "text-muted line-through decoration-black/25")}>{task.title}</p>
      {decor && <BreakdownBadges taskId={task.id} decor={decor} className="mt-2" />}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {assignee ? (
          <Avatar id={assignee.id} name={assignee.name} src={assignee.avatarUrl} size={26} />
        ) : (
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-dashed border-border-strong text-subtle" title="Unassigned">
            <UserRound className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[13px] text-muted" title={`${PRIORITY_STYLE[task.priority].label} priority`}>
          <PriorityFlag priority={task.priority} size={15} />
          {PRIORITY_STYLE[task.priority].label}
        </span>
        <DueChip due={task.dueDate} done={!!done} />
        {task.estimateHours ? (
          <span title={`${task.estimateHours}h estimated`} className="ml-auto inline-flex items-center gap-1 text-[12.5px] tabular-nums text-muted">
            <Timer className="h-3.5 w-3.5" /> {task.estimateHours}h
          </span>
        ) : null}
        <PointsBadge points={task.storyPoints} className={task.estimateHours ? undefined : "ml-auto"} />
      </div>
    </article>
  );
}

/** "4/5" next to a status with a work-in-progress limit; amber at the limit, red over it. */
function WipBadge({ count, limit }: { count: number; limit?: number | null }) {
  if (!limit) return null;
  const over = count > limit;
  const at = count === limit;
  return (
    <span
      title={over ? `Over the WIP limit of ${limit}` : `WIP limit ${limit}`}
      className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold tabular-nums",
        over ? "bg-rose-100 text-rose-700" : at ? "bg-amber-100 text-amber-800" : "bg-white/80 text-subtle")}
    >
      {over && <AlertTriangle className="h-3 w-3" />}
      {count}/{limit}
    </span>
  );
}

function LaneCell({ id, color, children }: { id: string; color: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("flex min-h-16 min-w-[260px] flex-1 basis-0 flex-col gap-2 rounded-lg p-1.5 transition-shadow", isOver && "shadow-[0_0_0_2px_var(--color-primary)]")} style={{ backgroundColor: `${color}10` }}>
      {children}
    </div>
  );
}
