"use client";

import { useMemo, useState } from "react";
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
import { AlignLeft, Plus, UserRound } from "lucide-react";
import type { PresenceUser, TaskDTO } from "@/lib/realtime-protocol";
import { positionForIndex } from "@/lib/fractional-index";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { PRIORITY_STYLE, PriorityFlag, StatusPill } from "@/components/ui/badge";
import { groupByColumn } from "../board-state";
import { BreakdownBadges, DueChip, ParentRef, PointsBadge, TypeIcon } from "../task-meta";
import type { TaskDecor } from "../decor";
import type { Column, Member } from "../kanban-board";
import type { ViewProps } from "./types";

/**
 * Kanban board. Drag state is local; the parent's `onMove` owns the optimistic
 * update, server call, conflict rollback and explanation.
 */
export function BoardView(props: ViewProps & { projectId: string; onMove: (task: TaskDTO, columnId: string, position: number) => void }) {
  const { tasks, columns } = props;
  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const [dragItems, setDragItems] = useState<Record<string, string[]> | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const grouped = useMemo(() => dragItems ?? groupByColumn(tasks, columnIds), [dragItems, tasks, columnIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const findContainer = (items: Record<string, string[]>, id: string) =>
    id in items ? id : Object.keys(items).find((c) => items[c]!.includes(id));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setDragItems(groupByColumn(tasks, columnIds));
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
    const toCol = findContainer(items, String(over.id));
    if (!task || !toCol) return;

    let list = items[toCol]!;
    const oldIdx = list.indexOf(taskId);
    const overIdx = list.indexOf(String(over.id));
    if (overIdx >= 0 && oldIdx !== overIdx) list = arrayMove(list, oldIdx, overIdx);
    const index = list.indexOf(taskId);

    const before = groupByColumn(tasks, columnIds);
    if (task.columnId === toCol && before[toCol]!.indexOf(taskId) === index) return; // dropped in place

    const neighbours = list.filter((id) => id !== taskId).map((id) => tasks[id]!.position);
    props.onMove(task, toCol, positionForIndex(neighbours, index).position);
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
        <PointsBadge points={task.storyPoints} className="ml-auto" />
      </div>
    </article>
  );
}
