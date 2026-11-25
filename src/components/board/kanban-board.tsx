"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { toast } from "sonner";
import { AlignLeft, ChevronDown, ChevronRight, Eye, Kanban, List as ListIcon, Plus, Shuffle, Sparkles, UserRound } from "lucide-react";
import type { OrgRole } from "@/db/schema";
import type { OrgEvent, PresenceUser, TaskDTO } from "@/lib/realtime-protocol";
import { positionForIndex } from "@/lib/fractional-index";
import { can } from "@/lib/rbac-shared";
import { cn, timeAgo } from "@/lib/utils";
import { explainConflictAction } from "@/actions/ai.actions";
import { getBoardSnapshotAction, moveTaskAction } from "@/actions/task.actions";
import { simulateTeammateAction } from "@/actions/demo.actions";
import { Avatar } from "@/components/ui/avatar";
import { PRIORITY_STYLE, PriorityFlag, StatusPill, statusColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { boardReducer, groupByColumn, initBoard } from "./board-state";
import { useRealtime, type ConnectionStatus } from "./use-realtime";
import { TaskDrawer } from "./task-drawer";
import { NewTaskDialog } from "./new-task-dialog";
import { DigestPanel } from "./digest-panel";

export type Member = { id: string; name: string; avatarUrl: string | null; role: OrgRole };
export type Column = { id: string; title: string };
export type BoardCtx = {
  org: { id: string; slug: string; name: string; isDemo: boolean };
  project: { id: string; key: string; name: string };
  columns: Column[];
  members: Member[];
  me: { id: string; name: string };
  role: OrgRole;
  aiEnabled: boolean;
};

export function KanbanBoard(props: BoardCtx & { initialTasks: TaskDTO[] }) {
  const { org, project, columns, members, me, role } = props;
  const router = useRouter();
  const [state, dispatch] = useReducer(boardReducer, props.initialTasks, initBoard);
  const [dragItems, setDragItems] = useState<Record<string, string[]> | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState<Record<string, true>>({});
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [newColumnId, setNewColumnId] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "list">("board");
  const [showDigest, setShowDigest] = useState(false);
  const [simPending, startSim] = useTransition();
  /** `${taskId}:${version}` of writes this tab made, to tell our own echoes from another tab's. */
  const ownWrites = useRef(new Set<string>());

  const canEdit = can(role, "CREATE_OR_MOVE_TASK");
  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const colTitle = useCallback((id: string) => columns.find((c) => c.id === id)?.title ?? "another column", [columns]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const ref = (t: { taskNumber: number }) => `${project.key}-${t.taskNumber}`;
  const grouped = useMemo(() => dragItems ?? groupByColumn(state.tasks, columnIds), [dragItems, state.tasks, columnIds]);

  const flashTask = (id: string) => {
    setFlash((f) => ({ ...f, [id]: true }));
    setTimeout(() => setFlash(({ [id]: _, ...rest }) => rest), 1600);
  };

  const resync = useCallback(async () => {
    const res = await getBoardSnapshotAction(org.id, project.id);
    if (res.ok) dispatch({ type: "reset", tasks: res.tasks });
  }, [org.id, project.id]);

  /* ----------------------------- realtime ----------------------------- */
  const onEvent = useCallback(
    (e: OrgEvent) => {
      switch (e.type) {
        case "TASK_CREATED":
        case "TASK_UPDATED": {
          if (e.task.projectId !== project.id) return;
          dispatch({ type: "server", task: e.task });
          const mine = ownWrites.current.has(`${e.task.id}:${e.task.version}`);
          if (mine) return;
          flashTask(e.task.id);
          const who = e.actor.id === me.id ? "You (another tab)" : e.actor.name;
          const what =
            e.type === "TASK_CREATED"
              ? `created ${ref(e.task)}`
              : e.action === "moved"
                ? `moved ${ref(e.task)} to ${colTitle(e.task.columnId)}`
                : `updated ${e.changes?.join(", ") || "details of"} ${ref(e.task)}`;
          toast(`${who} ${what}`, { duration: 2500 });
          return;
        }
        case "TASK_DELETED":
          if (e.projectId !== project.id) return;
          dispatch({ type: "remove", taskId: e.taskId });
          if (openTaskId === e.taskId) setOpenTaskId(null);
          return;
        case "COLUMN_REBALANCED":
          dispatch({ type: "rebalance", positions: e.positions });
          return;
        case "COMMENT_ADDED":
          if (e.taskId === openTaskId) setCommentsVersion((v) => v + 1);
          return;
        case "MEMBERSHIP_CHANGED":
          if (e.userId === me.id) router.refresh();
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.id, me.id, openTaskId, colTitle, router]
  );

  const { status, presence, connectionId, sendPresence } = useRealtime({ organizationId: org.id, onEvent, onResync: resync });

  useEffect(() => {
    sendPresence({ projectId: project.id, activeTaskId: openTaskId, editing: !!openTaskId && editing });
  }, [project.id, openTaskId, editing, sendPresence]);

  const others = presence.filter((p) => p.connectionId !== connectionId);
  const presenceByTask = useMemo(() => {
    const m = new Map<string, PresenceUser[]>();
    for (const p of others) if (p.activeTaskId) m.set(p.activeTaskId, [...(m.get(p.activeTaskId) ?? []), p]);
    return m;
  }, [others]);

  /* ---------------------------- drag & drop ---------------------------- */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const findContainer = (items: Record<string, string[]>, id: string) =>
    id in items ? id : Object.keys(items).find((c) => items[c]!.includes(id));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
    setDragItems(groupByColumn(state.tasks, columnIds));
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
      return {
        ...items,
        [from]: items[from]!.filter((id) => id !== a),
        [to]: [...target.slice(0, index), a, ...target.slice(index)],
      };
    });
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    const items = dragItems;
    setDragItems(null);
    setActiveId(null);
    if (!over || !items) return;
    const taskId = String(active.id);
    const task = state.tasks[taskId];
    const toCol = findContainer(items, String(over.id));
    if (!task || !toCol) return;

    let list = items[toCol]!;
    const oldIdx = list.indexOf(taskId);
    const overIdx = list.indexOf(String(over.id));
    if (overIdx >= 0 && oldIdx !== overIdx) list = arrayMove(list, oldIdx, overIdx);
    const index = list.indexOf(taskId);

    const before = groupByColumn(state.tasks, columnIds);
    if (task.columnId === toCol && before[toCol]!.indexOf(taskId) === index) return; // dropped in place

    const neighbours = list.filter((id) => id !== taskId).map((id) => state.tasks[id]!.position);
    const { position } = positionForIndex(neighbours, index);

    // 1) optimistic: 0ms perceived latency
    dispatch({ type: "optimisticMove", taskId, columnId: toCol, position });
    ownWrites.current.add(`${taskId}:${task.version + 1}`);

    // 2) server verifies role, tenant and version
    const res = await moveTaskAction({
      organizationId: org.id,
      taskId,
      targetColumnId: toCol,
      newPosition: position,
      expectedVersion: task.version,
    });

    if (!res.ok) {
      dispatch({ type: "force", task }); // rollback
      toast.error(res.code.startsWith("FORBIDDEN") ? `Not allowed: your role can't move tasks (${res.code})` : res.message);
      return;
    }
    if (res.conflict) {
      // 3) someone else won the race → roll back to their version and explain
      if (res.current) dispatch({ type: "force", task: res.current });
      else dispatch({ type: "remove", taskId });
      flashTask(taskId);
      const id = toast.loading("Card updated by a teammate — syncing board…");
      void resync();
      const exp = await explainConflictAction(org.id, taskId, task.version);
      toast.info(exp.ok ? exp.summary : "Card updated by a teammate — board synced.", { id, duration: 6000 });
      return;
    }
    dispatch({ type: "server", task: res.task });
    if (res.rebalanced) dispatch({ type: "rebalance", positions: res.rebalanced });
  }

  const activeTask = activeId ? state.tasks[activeId] : null;
  const openTask = openTaskId ? state.tasks[openTaskId] : null;
  const ctx: BoardCtx = props;
  const total = Object.keys(state.tasks).length;
  const doneCount = grouped[columns[columns.length - 1]?.id ?? ""]?.length ?? 0;
  const colorOf = (i: number) => statusColor(i, columns.length);
  const openNew = (columnId?: string) => {
    setNewColumnId(columnId ?? columns[0]?.id ?? null);
    setShowNew(true);
  };

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* ---------- header ---------- */}
      <header className="border-b border-border bg-white px-8 pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-[13px] font-bold text-white shadow-[0_2px_8px_-2px_rgba(123,104,238,0.6)]">
              {project.key.slice(0, 2)}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13px] text-subtle">
                <span>{org.name}</span>
                <ChevronRight className="h-3.5 w-3.5" />
                <span>{project.key}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <h1 className="truncate text-[22px] font-bold leading-tight tracking-tight">{project.name}</h1>
                <LiveDot status={status} />
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <PresenceBar users={presence} myConnectionId={connectionId} projectId={project.id} />
            {org.isDemo && canEdit && (
              <Button
                variant="outline"
                size="sm"
                disabled={simPending}
                title="A seeded teammate moves or edits a random card through the real server path"
                onClick={() =>
                  startSim(async () => {
                    const r = await simulateTeammateAction(org.id, project.id);
                    if (!r.ok) toast.error(r.message);
                  })
                }
              >
                <Shuffle className="h-4 w-4" /> Simulate teammate
              </Button>
            )}
            <Button variant="ai" size="sm" onClick={() => setShowDigest(true)}>
              <Sparkles className="h-4 w-4" /> AI standup
            </Button>
            {canEdit && (
              <Button size="sm" onClick={() => openNew()}>
                <Plus className="h-4 w-4" /> Add Task
              </Button>
            )}
          </div>
        </div>

        {/* view tabs */}
        <div className="mt-3 flex items-end gap-1">
          {([
            ["board", "Board", Kanban],
            ["list", "List", ListIcon],
          ] as const).map(([v, label, Icon]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "flex cursor-pointer items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[15px] font-medium transition-colors",
                view === v ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
          <div className="mb-2 ml-auto hidden items-center gap-3 lg:flex">
            <Progress done={doneCount} total={total} />
          </div>
        </div>
      </header>

      {!canEdit && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-8 py-2.5 text-[15px] text-amber-800">
          <Eye className="h-4 w-4" />
          Read-only — you are a <b className="font-semibold">viewer</b>. The server rejects viewer mutations regardless of what the UI allows.
        </div>
      )}

      {/* ---------- board view ---------- */}
      {view === "board" ? (
        <DndContext id={`board-${project.id}`} sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setDragItems(null); setActiveId(null); }}>
          <div className="flex flex-1 gap-4 overflow-x-auto bg-canvas px-8 py-6">
            {columns.map((col, i) => (
              <BoardColumn key={col.id} column={col} color={colorOf(i)} count={grouped[col.id]?.length ?? 0} canAdd={canEdit} onAdd={() => openNew(col.id)}>
                <SortableContext items={grouped[col.id] ?? []} strategy={verticalListSortingStrategy}>
                  {(grouped[col.id] ?? []).map((id) => {
                    const t = state.tasks[id];
                    if (!t) return null;
                    return (
                      <SortableCard
                        key={id}
                        task={t}
                        refLabel={ref(t)}
                        disabled={!canEdit}
                        done={i === columns.length - 1}
                        assignee={t.assigneeId ? memberById.get(t.assigneeId) : undefined}
                        viewers={presenceByTask.get(id) ?? []}
                        flash={!!flash[id]}
                        onOpen={() => setOpenTaskId(id)}
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
                refLabel={ref(activeTask)}
                assignee={activeTask.assigneeId ? memberById.get(activeTask.assigneeId) : undefined}
                viewers={[]}
                className="rotate-[2deg] cursor-grabbing shadow-glow"
              />
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <ListView
          columns={columns}
          grouped={grouped}
          tasks={state.tasks}
          colorOf={colorOf}
          refOf={ref}
          memberById={memberById}
          presenceByTask={presenceByTask}
          flash={flash}
          canAdd={canEdit}
          onAdd={openNew}
          onOpen={setOpenTaskId}
        />
      )}

      {openTask && (
        <TaskDrawer
          key={openTask.id}
          ctx={ctx}
          task={openTask}
          viewers={presenceByTask.get(openTask.id) ?? []}
          commentsVersion={commentsVersion}
          onClose={() => { setOpenTaskId(null); setEditing(false); }}
          onEditingChange={setEditing}
          onServerTask={(t) => { ownWrites.current.add(`${t.id}:${t.version}`); dispatch({ type: "server", task: t }); }}
          onForceTask={(t) => dispatch({ type: "force", task: t })}
          onRemoved={(id) => { dispatch({ type: "remove", taskId: id }); setOpenTaskId(null); }}
          onCreated={(ts) => ts.forEach((t) => { ownWrites.current.add(`${t.id}:${t.version}`); dispatch({ type: "server", task: t }); })}
        />
      )}
      {showNew && (
        <NewTaskDialog
          ctx={ctx}
          initialColumnId={newColumnId ?? undefined}
          onClose={() => setShowNew(false)}
          onCreated={(t) => { ownWrites.current.add(`${t.id}:${t.version}`); dispatch({ type: "server", task: t }); flashTask(t.id); }}
        />
      )}
      {showDigest && <DigestPanel ctx={ctx} onClose={() => setShowDigest(false)} />}
    </div>
  );
}

/* --------------------------------- pieces --------------------------------- */

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5 text-[13px] text-muted">
      <span>
        <b className="font-semibold text-foreground">{done}</b>/{total} done
      </span>
      <div className="h-2 w-36 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-[#2db87d] transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-semibold text-foreground">{pct}%</span>
    </div>
  );
}

function LiveDot({ status }: { status: ConnectionStatus }) {
  const live = status === "live";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12.5px] font-semibold",
        live ? "bg-emerald-50 text-emerald-700" : "bg-surface-2 text-muted"
      )}
      title={live ? "Connected to the org's real-time room" : "Reconnecting…"}
    >
      <span className="relative flex h-2 w-2">
        {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", live ? "bg-emerald-500" : "bg-zinc-400")} />
      </span>
      {live ? "Live" : status === "connecting" ? "Connecting" : "Offline"}
    </span>
  );
}

function PresenceBar({ users, myConnectionId, projectId }: { users: PresenceUser[]; myConnectionId: string | null; projectId: string }) {
  const here = users.filter((u) => u.projectId === projectId);
  const unique = [...new Map(here.map((u) => [u.userId, u])).values()];
  if (unique.length === 0) return null;
  const meId = users.find((x) => x.connectionId === myConnectionId)?.userId;
  const myTabs = here.filter((u) => u.userId === meId).length;
  return (
    <div className="mr-1 flex items-center gap-2" title={unique.map((u) => u.name).join(", ")}>
      <div className="flex -space-x-2">
        {unique.slice(0, 5).map((u) => (
          <span key={u.userId} className="relative">
            <Avatar id={u.userId} name={u.name} src={u.avatarUrl} size={30} ring />
            <span className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
          </span>
        ))}
      </div>
      <span className="text-[13px] text-muted">
        {unique.length} viewing{myTabs > 1 ? ` · ${myTabs} tabs` : ""}
      </span>
    </div>
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
        <div className="h-[104px] rounded-lg border-2 border-dashed border-primary/40 bg-primary-soft" />
      ) : (
        <CardBody {...props} className={cn(props.flash && "animate-flash", !props.disabled && "cursor-grab active:cursor-grabbing")} />
      )}
    </div>
  );
}

function CardBody({
  task,
  refLabel,
  assignee,
  viewers,
  done,
  className,
}: {
  task: TaskDTO;
  refLabel: string;
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
        <span className="font-medium">{refLabel}</span>
        {task.description && <AlignLeft className="h-3.5 w-3.5" />}
        {someone && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-semibold text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {someone.name.split(" ")[0]} {editor ? "editing…" : "viewing"}
          </span>
        )}
      </div>
      <p className={cn("mt-1.5 text-[16px] font-medium leading-snug text-foreground", done && "text-muted line-through decoration-black/25")}>{task.title}</p>
      <div className="mt-3 flex items-center gap-2.5">
        {assignee ? (
          <Avatar id={assignee.id} name={assignee.name} src={assignee.avatarUrl} size={26} />
        ) : (
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-dashed border-border-strong text-subtle" title="Unassigned">
            <UserRound className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted" title={`${PRIORITY_STYLE[task.priority].label} priority`}>
          <PriorityFlag priority={task.priority} size={15} />
          {PRIORITY_STYLE[task.priority].label}
        </span>
        <span className="ml-auto text-[12px] text-subtle opacity-0 transition-opacity group-hover:opacity-100">v{task.version}</span>
      </div>
    </article>
  );
}

/* --------------------------------- list view -------------------------------- */

function ListView(props: {
  columns: Column[];
  grouped: Record<string, string[]>;
  tasks: Record<string, TaskDTO>;
  colorOf: (i: number) => string;
  refOf: (t: { taskNumber: number }) => string;
  memberById: Map<string, Member>;
  presenceByTask: Map<string, PresenceUser[]>;
  flash: Record<string, true>;
  canAdd: boolean;
  onAdd: (columnId: string) => void;
  onOpen: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className="flex-1 overflow-auto bg-white px-8 py-6">
      <div className="space-y-7">
        {props.columns.map((col, i) => {
          const ids = props.grouped[col.id] ?? [];
          const color = props.colorOf(i);
          const isCollapsed = collapsed[col.id];
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
              </div>
              {!isCollapsed && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="grid grid-cols-[minmax(0,1fr)_170px_130px_110px_110px] border-b border-border bg-surface-2 px-4 py-2 text-[12.5px] font-semibold uppercase tracking-wide text-subtle">
                    <span>Name</span>
                    <span>Assignee</span>
                    <span>Priority</span>
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
                          "grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_170px_130px_110px_110px] items-center border-b border-border px-4 py-3 text-left text-[15px] transition-colors last:border-0 hover:bg-[#fafafe]",
                          props.flash[id] && "animate-flash"
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2" style={{ borderColor: color, backgroundColor: i === props.columns.length - 1 ? color : "transparent" }} />
                          <span className="truncate font-medium">{t.title}</span>
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
                        <span className="flex items-center gap-1.5 text-[14px] text-muted">
                          <PriorityFlag priority={t.priority} /> {PRIORITY_STYLE[t.priority].label}
                        </span>
                        <span className="text-[14px] text-subtle">{props.refOf(t)}</span>
                        <span className="text-[14px] text-subtle">{timeAgo(t.updatedAt)}</span>
                      </button>
                    );
                  })}
                  {props.canAdd && (
                    <button
                      onClick={() => props.onAdd(col.id)}
                      className="flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-[14px] font-medium text-subtle transition-colors hover:bg-hover hover:text-foreground"
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
