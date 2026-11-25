"use client";

import { useMemo, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { CalendarX2, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { TaskDTO } from "@/lib/realtime-protocol";
import { addDays, addMonths, diffDays, formatMonth, startOfMonth, startOfWeek, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { PriorityFlag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TaskPatch, ViewProps } from "./types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_DAY = 4;

/**
 * Month calendar by due date. Dropping a task on a day reschedules it; if it has a
 * start date, the start moves by the same delta so the task keeps its duration.
 */
export function CalendarView(props: ViewProps & { onPatch: (task: TaskDTO, patch: TaskPatch) => void }) {
  const today = todayISO();
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const gridStart = startOfWeek(month);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);

  const colIndex = useMemo(() => new Map(props.columns.map((c, i) => [c.id, i])), [props.columns]);
  const byDay = useMemo(() => {
    const m = new Map<string, TaskDTO[]>();
    for (const t of Object.values(props.tasks)) {
      if (!t.dueDate) continue;
      m.set(t.dueDate, [...(m.get(t.dueDate) ?? []), t]);
    }
    for (const list of m.values()) list.sort((a, b) => (colIndex.get(a.columnId) ?? 0) - (colIndex.get(b.columnId) ?? 0) || a.taskNumber - b.taskNumber);
    return m;
  }, [props.tasks, colIndex]);
  const unscheduled = useMemo(() => Object.values(props.tasks).filter((t) => !t.dueDate).sort((a, b) => a.taskNumber - b.taskNumber), [props.tasks]);

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragId(null);
    const task = props.tasks[String(active.id)];
    if (!task || !over) return;
    const target = String(over.id);
    if (target === "__unscheduled") {
      if (task.dueDate) props.onPatch(task, { dueDate: null, startDate: null });
      return;
    }
    if (task.dueDate === target) return;
    const patch: TaskPatch = { dueDate: target };
    if (task.startDate && task.dueDate) patch.startDate = addDays(task.startDate, diffDays(task.dueDate, target));
    else if (task.startDate && task.startDate > target) patch.startDate = target;
    props.onPatch(task, patch);
  }

  const colorOf = (t: TaskDTO) => props.colorOf(colIndex.get(t.columnId) ?? 0);
  const dragTask = dragId ? props.tasks[dragId] : null;

  return (
    <DndContext id="calendar-dnd" sensors={sensors} onDragStart={(e) => setDragId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
      <div className="flex min-h-0 flex-1 bg-white">
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-8 py-5">
          {/* toolbar */}
          <div className="mb-4 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMonth(startOfMonth(today))}>Today</Button>
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setMonth((m) => addMonths(m, -1))}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => setMonth((m) => addMonths(m, 1))}>
              <ChevronRight className="h-5 w-5" />
            </Button>
            <h2 className="ml-1 text-xl font-bold tracking-tight">{formatMonth(month)}</h2>
            <span className="ml-auto text-[14px] text-subtle">{props.canEdit ? "Drag tasks between days to reschedule" : "Read-only"}</span>
          </div>

          {/* grid */}
          <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-border">
            {WEEKDAYS.map((d) => (
              <div key={d} className="border-b border-border bg-surface-2 px-3 py-2 text-[13px] font-semibold uppercase tracking-wide text-subtle">
                {d}
              </div>
            ))}
            {days.map((day, i) => {
              const list = byDay.get(day) ?? [];
              const show = expanded === day ? list : list.slice(0, MAX_PER_DAY);
              return (
                <DayCell
                  key={day}
                  day={day}
                  inMonth={day.slice(0, 7) === month.slice(0, 7)}
                  isToday={day === today}
                  isWeekend={i % 7 >= 5}
                  lastRow={i >= 35}
                  lastCol={i % 7 === 6}
                  canAdd={props.canEdit}
                  onAdd={() => props.onAdd({ dueDate: day })}
                >
                  {show.map((t) => (
                    <CalendarChip
                      key={t.id}
                      task={t}
                      label={props.refOf(t)}
                      color={colorOf(t)}
                      done={t.columnId === props.doneColumnId}
                      overdue={t.columnId !== props.doneColumnId && day < today}
                      draggable={props.canEdit}
                      flash={!!props.flash[t.id]}
                      onOpen={() => props.onOpen(t.id)}
                    />
                  ))}
                  {list.length > MAX_PER_DAY && (
                    <button
                      onClick={() => setExpanded(expanded === day ? null : day)}
                      className="mt-0.5 cursor-pointer rounded px-1.5 text-left text-[12.5px] font-semibold text-primary hover:bg-primary-soft"
                    >
                      {expanded === day ? "Show less" : `+${list.length - MAX_PER_DAY} more`}
                    </button>
                  )}
                </DayCell>
              );
            })}
          </div>
        </div>

        {/* unscheduled tray */}
        <UnscheduledTray count={unscheduled.length}>
          {unscheduled.map((t) => (
            <CalendarChip
              key={t.id}
              task={t}
              label={props.refOf(t)}
              color={colorOf(t)}
              done={t.columnId === props.doneColumnId}
              overdue={false}
              draggable={props.canEdit}
              flash={!!props.flash[t.id]}
              onOpen={() => props.onOpen(t.id)}
              roomy
              assigneeName={t.assigneeId ? props.memberById.get(t.assigneeId)?.name : undefined}
              assigneeId={t.assigneeId ?? undefined}
            />
          ))}
        </UnscheduledTray>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragTask && (
          <div className="w-52 rotate-2">
            <CalendarChip
              task={dragTask}
              label={props.refOf(dragTask)}
              color={colorOf(dragTask)}
              done={false}
              overdue={false}
              draggable={false}
              flash={false}
              onOpen={() => {}}
              className="shadow-glow"
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function DayCell(props: {
  day: string;
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  lastRow: boolean;
  lastCol: boolean;
  canAdd: boolean;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.day });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative flex min-h-[124px] flex-col gap-1 p-1.5 transition-colors",
        !props.lastRow && "border-b border-border",
        !props.lastCol && "border-r border-border",
        props.isWeekend && "bg-[#fbfbfc]",
        !props.inMonth && "bg-surface-2/60",
        isOver && "bg-primary-soft"
      )}
    >
      <div className="flex items-center justify-between px-1">
        <span
          className={cn(
            "flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[14px] font-semibold",
            props.isToday ? "bg-primary text-white" : props.inMonth ? "text-foreground" : "text-subtle"
          )}
        >
          {Number(props.day.slice(8))}
        </span>
        {props.canAdd && (
          <button
            onClick={props.onAdd}
            aria-label={`Add task due ${props.day}`}
            className="cursor-pointer rounded-md p-1 text-subtle opacity-0 transition-opacity hover:bg-hover hover:text-foreground group-hover:opacity-100"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
      {props.children}
    </div>
  );
}

function CalendarChip(props: {
  task: TaskDTO;
  label: string;
  color: string;
  done: boolean;
  overdue: boolean;
  draggable: boolean;
  flash: boolean;
  onOpen: () => void;
  roomy?: boolean;
  assigneeName?: string;
  assigneeId?: string;
  className?: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: props.task.id, disabled: !props.draggable });
  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={props.onOpen}
      title={`${props.label} ${props.task.title}`}
      className={cn(
        "flex w-full items-center gap-1.5 overflow-hidden rounded-md border border-border bg-white text-left shadow-card transition-shadow hover:shadow-lift",
        props.roomy ? "px-2.5 py-2" : "px-1.5 py-1",
        props.draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        props.overdue && "border-red-200 bg-red-50/60",
        isDragging && "opacity-30",
        props.flash && "animate-flash",
        props.className
      )}
      style={{ borderLeft: `3px solid ${props.color}` }}
    >
      <PriorityFlag priority={props.task.priority} size={12} />
      <span className={cn("min-w-0 flex-1 truncate font-medium", props.roomy ? "text-[14px]" : "text-[13px]", props.done && "text-muted line-through")}>
        {props.task.title}
      </span>
      {props.roomy && props.assigneeId && props.assigneeName && <Avatar id={props.assigneeId} name={props.assigneeName} size={20} />}
    </button>
  );
}

function UnscheduledTray({ count, children }: { count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: "__unscheduled" });
  return (
    <aside ref={setNodeRef} className={cn("hidden w-72 shrink-0 flex-col border-l border-border bg-canvas xl:flex", isOver && "bg-primary-soft")}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
        <CalendarX2 className="h-4 w-4 text-subtle" />
        <h3 className="text-[15px] font-semibold">Unscheduled</h3>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[13px] font-semibold text-muted">{count}</span>
      </div>
      <p className="px-4 pt-3 text-[13px] text-subtle">Drag onto a day to set a due date, or drop a task here to clear its dates.</p>
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-3">{children}</div>
    </aside>
  );
}
