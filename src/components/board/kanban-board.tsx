"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, ChartGantt, ChevronRight, Eye, Kanban, LayoutDashboard, List as ListIcon, Plus, Shuffle, Sparkles } from "lucide-react";
import type { OrgRole } from "@/db/schema";
import type { OrgEvent, PresenceUser, TaskDTO } from "@/lib/realtime-protocol";
import { can } from "@/lib/rbac-shared";
import { cn } from "@/lib/utils";
import { explainConflictAction } from "@/actions/ai.actions";
import { getBoardSnapshotAction, moveTaskAction, updateTaskAction } from "@/actions/task.actions";
import { simulateTeammateAction } from "@/actions/demo.actions";
import { getProjectMetaAction } from "@/actions/breakdown.actions";
import type { ProjectMeta } from "@/server/services/breakdown";
import { POSITION_STEP } from "@/lib/fractional-index";
import { Avatar } from "@/components/ui/avatar";
import { DONE_COLOR, statusColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { boardReducer, initBoard } from "./board-state";
import { useRealtime, type ConnectionStatus } from "./use-realtime";
import { TaskDrawer } from "./task-drawer";
import { NewTaskDialog } from "./new-task-dialog";
import { DigestPanel } from "./digest-panel";
import { FilterBar } from "./filter-bar";
import { applyFilters, EMPTY_FILTERS, type Filters } from "./filters";
import { buildDecor, EMPTY_META } from "./decor";
import { BoardView } from "./views/board-view";
import { ListView } from "./views/list-view";
import { CalendarView } from "./views/calendar-view";
import { TimelineView } from "./views/timeline-view";
import { DashboardView } from "./views/dashboard-view";
import { VIEWS, type TaskPatch, type ViewId, type ViewProps } from "./views/types";

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

const VIEW_META: Record<ViewId, { label: string; icon: typeof Kanban }> = {
  board: { label: "Board", icon: Kanban },
  list: { label: "List", icon: ListIcon },
  calendar: { label: "Calendar", icon: CalendarDays },
  timeline: { label: "Timeline", icon: ChartGantt },
  dashboard: { label: "Dashboard", icon: LayoutDashboard },
};

/**
 * Project workspace: owns task state, the realtime subscription, filters and the
 * two write paths (move, field patch). Views are pure renderers over filtered tasks.
 */
export function KanbanBoard(props: BoardCtx & { initialTasks: TaskDTO[] }) {
  const { org, project, columns, members, me, role } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(boardReducer, props.initialTasks, initBoard);
  const [view, setViewState] = useState<ViewId>(() => {
    const v = searchParams.get("view");
    return (VIEWS as readonly string[]).includes(v ?? "") ? (v as ViewId) : "board";
  });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState<Record<string, true>>({});
  const [commentsVersion, setCommentsVersion] = useState(0);
  const [newTask, setNewTask] = useState<{ columnId?: string; dueDate?: string } | null>(null);
  const [showDigest, setShowDigest] = useState(false);
  const [meta, setMeta] = useState<ProjectMeta>(EMPTY_META);
  /** Bumped whenever meta reloads, so an open drawer refetches its checklist. */
  const [metaVersion, setMetaVersion] = useState(0);
  const [simPending, startSim] = useTransition();
  /** `${taskId}:${version}` of writes this tab made, to tell our own echoes from another tab's. */
  const ownWrites = useRef(new Set<string>());

  const canEdit = can(role, "CREATE_OR_MOVE_TASK");
  const doneColumnId = columns[columns.length - 1]?.id ?? null;
  const colTitle = useCallback((id: string) => columns.find((c) => c.id === id)?.title ?? "another column", [columns]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const refOf = useCallback((t: { taskNumber: number }) => `${project.key}-${t.taskNumber}`, [project.key]);
  const visible = useMemo(
    () => applyFilters(state.tasks, filters, { meId: me.id, doneColumnId, refOf, tagsByTask: meta.tagsByTask }),
    [state.tasks, filters, me.id, doneColumnId, refOf, meta.tagsByTask]
  );
  const decor = useMemo(() => buildDecor(state.tasks, meta, doneColumnId), [state.tasks, meta, doneColumnId]);

  /* Project meta (checklists, tags, dependencies): load once, then debounce refreshes. */
  const metaTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadMeta = useCallback(
    (delay = 0) => {
      clearTimeout(metaTimer.current);
      metaTimer.current = setTimeout(async () => {
        const r = await getProjectMetaAction(org.id, project.id);
        if (r.ok) {
          setMeta(r.meta);
          setMetaVersion((v) => v + 1);
        }
      }, delay);
    },
    [org.id, project.id]
  );
  useEffect(() => {
    loadMeta();
    return () => clearTimeout(metaTimer.current);
  }, [loadMeta]);

  /** Keep the view in the URL (shareable, survives refresh) without a navigation. */
  const setView = (v: ViewId) => {
    setViewState(v);
    const url = new URL(window.location.href);
    if (v === "board") url.searchParams.delete("view");
    else url.searchParams.set("view", v);
    window.history.replaceState(null, "", url);
  };

  const flashTask = (id: string) => {
    setFlash((f) => ({ ...f, [id]: true }));
    setTimeout(() => setFlash(({ [id]: _, ...rest }) => rest), 1600);
  };

  const resync = useCallback(async () => {
    const res = await getBoardSnapshotAction(org.id, project.id);
    if (res.ok) dispatch({ type: "reset", tasks: res.tasks });
    loadMeta();
  }, [org.id, project.id, loadMeta]);

  /* ----------------------------- realtime ----------------------------- */
  const onEvent = useCallback(
    (e: OrgEvent) => {
      switch (e.type) {
        case "TASK_CREATED":
        case "TASK_UPDATED": {
          if (e.task.projectId !== project.id) return;
          dispatch({ type: "server", task: e.task });
          if (ownWrites.current.has(`${e.task.id}:${e.task.version}`)) return;
          flashTask(e.task.id);
          const who = e.actor.id === me.id ? "You (another tab)" : e.actor.name;
          const what =
            e.type === "TASK_CREATED"
              ? `created ${refOf(e.task)}`
              : e.action === "moved"
                ? `moved ${refOf(e.task)} to ${colTitle(e.task.columnId)}`
                : `updated ${e.changes?.join(", ") || "details of"} ${refOf(e.task)}`;
          toast(`${who} ${what}`, { duration: 2500 });
          return;
        }
        case "TASK_DELETED":
          if (e.projectId !== project.id) return;
          dispatch({ type: "remove", taskId: e.taskId });
          if (openTaskId === e.taskId) setOpenTaskId(null);
          loadMeta(250); // the cascade removed its checklist, tags and dependencies
          return;
        case "TASK_META_CHANGED":
          if (e.projectId !== project.id) return;
          loadMeta(250);
          if (e.actor.id !== me.id) e.taskIds.forEach(flashTask);
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
    [project.id, me.id, openTaskId, colTitle, refOf, router, loadMeta]
  );

  const { status, presence, connectionId, sendPresence } = useRealtime({ organizationId: org.id, onEvent, onResync: resync });

  useEffect(() => {
    sendPresence({ projectId: project.id, activeTaskId: openTaskId, editing: !!openTaskId && editing });
  }, [project.id, openTaskId, editing, sendPresence]);

  const presenceByTask = useMemo(() => {
    const m = new Map<string, PresenceUser[]>();
    for (const p of presence) {
      if (p.connectionId === connectionId || !p.activeTaskId) continue;
      m.set(p.activeTaskId, [...(m.get(p.activeTaskId) ?? []), p]);
    }
    return m;
  }, [presence, connectionId]);

  /* ---------------------------- write paths ---------------------------- */

  async function handleConflict(task: TaskDTO, current: TaskDTO | null) {
    if (current) dispatch({ type: "force", task: current });
    else dispatch({ type: "remove", taskId: task.id });
    flashTask(task.id);
    const id = toast.loading("Card updated by a teammate — syncing board…");
    void resync();
    const exp = await explainConflictAction(org.id, task.id, task.version);
    toast.info(exp.ok ? exp.summary : "Card updated by a teammate — board synced.", { id, duration: 6000 });
  }

  /** Optimistic move → version-checked server write → rollback + explanation on conflict. */
  async function commitMove(task: TaskDTO, columnId: string, position: number) {
    dispatch({ type: "optimisticMove", taskId: task.id, columnId, position });
    ownWrites.current.add(`${task.id}:${task.version + 1}`);
    const res = await moveTaskAction({ organizationId: org.id, taskId: task.id, targetColumnId: columnId, newPosition: position, expectedVersion: task.version });
    if (!res.ok) {
      dispatch({ type: "force", task });
      toast.error(res.code.startsWith("FORBIDDEN") ? "Your role doesn't allow moving tasks." : res.message);
      return;
    }
    if (res.conflict) return handleConflict(task, res.current);
    dispatch({ type: "server", task: res.task });
    if (res.rebalanced) dispatch({ type: "rebalance", positions: res.rebalanced });
  }

  /** Complete <-> reopen: moves the task to the end of the done (or first) column. */
  function toggleDone(task: TaskDTO) {
    const target = task.columnId === doneColumnId ? columns[0]?.id : doneColumnId;
    if (!target) return;
    const last = Object.values(state.tasks)
      .filter((t) => t.columnId === target && t.id !== task.id)
      .reduce((m, t) => Math.max(m, t.position), 0);
    void commitMove(task, target, last + POSITION_STEP);
  }

  /** Same contract for field edits made directly in a view (calendar/timeline). */
  async function commitPatch(task: TaskDTO, patch: TaskPatch) {
    dispatch({ type: "force", task: { ...task, ...patch } });
    ownWrites.current.add(`${task.id}:${task.version + 1}`);
    const res = await updateTaskAction({ organizationId: org.id, taskId: task.id, expectedVersion: task.version, patch });
    if (!res.ok) {
      dispatch({ type: "force", task });
      toast.error(res.message);
      return;
    }
    if (res.conflict) return handleConflict(task, res.current);
    dispatch({ type: "server", task: res.task });
    if ("dueDate" in patch) toast.success(patch.dueDate ? `${refOf(task)} rescheduled` : `${refOf(task)} unscheduled`, { duration: 1800 });
  }

  /* ------------------------------- render ------------------------------- */
  const openTask = openTaskId ? state.tasks[openTaskId] : null;
  const ctx: BoardCtx = props;
  const all = Object.values(state.tasks);
  const doneCount = all.filter((t) => t.columnId === doneColumnId).length;

  const viewProps: ViewProps = {
    tasks: visible,
    columns,
    colorOf: (i) => statusColor(i, columns.length),
    doneColumnId,
    refOf,
    memberById,
    presenceByTask,
    flash,
    canEdit,
    onOpen: setOpenTaskId,
    onAdd: (opts) => setNewTask(opts ?? {}),
    decor,
    allTasks: state.tasks,
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
              <Button size="sm" onClick={() => setNewTask({})}>
                <Plus className="h-4 w-4" /> Add Task
              </Button>
            )}
          </div>
        </div>

        <nav className="mt-3 flex items-end gap-1 overflow-x-auto" aria-label="Views">
          {VIEWS.map((v) => {
            const { label, icon: Icon } = VIEW_META[v];
            return (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-current={view === v ? "page" : undefined}
                className={cn(
                  "flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[15px] font-medium transition-colors",
                  view === v ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            );
          })}
          <div className="mb-2 ml-auto hidden items-center gap-3 lg:flex">
            <Progress done={doneCount} total={all.length} />
          </div>
        </nav>
      </header>

      <FilterBar filters={filters} onChange={setFilters} members={members} tags={decor.tags} shown={Object.keys(visible).length} total={all.length} />

      {!canEdit && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-8 py-2.5 text-[15px] text-amber-800">
          <Eye className="h-4 w-4" />
          You have view-only access to this project as a <b className="font-semibold">viewer</b>.
        </div>
      )}

      {view === "board" && <BoardView {...viewProps} projectId={project.id} onMove={commitMove} />}
      {view === "list" && <ListView {...viewProps} />}
      {view === "calendar" && <CalendarView {...viewProps} onPatch={commitPatch} />}
      {view === "timeline" && <TimelineView {...viewProps} onPatch={commitPatch} />}
      {view === "dashboard" && <DashboardView {...viewProps} organizationId={org.id} projectId={project.id} filtered={visible !== state.tasks} />}

      {openTask && (
        <TaskDrawer
          key={openTask.id}
          ctx={ctx}
          task={openTask}
          viewers={presenceByTask.get(openTask.id) ?? []}
          commentsVersion={commentsVersion}
          allTasks={state.tasks}
          decor={decor}
          metaVersion={metaVersion}
          onMetaChanged={() => loadMeta()}
          onOpenTask={setOpenTaskId}
          onToggleDone={toggleDone}
          onClose={() => {
            setOpenTaskId(null);
            setEditing(false);
          }}
          onEditingChange={setEditing}
          onServerTask={(t) => {
            ownWrites.current.add(`${t.id}:${t.version}`);
            dispatch({ type: "server", task: t });
          }}
          onForceTask={(t) => dispatch({ type: "force", task: t })}
          onRemoved={(id) => {
            dispatch({ type: "remove", taskId: id });
            setOpenTaskId(null);
          }}
          onCreated={(ts) =>
            ts.forEach((t) => {
              ownWrites.current.add(`${t.id}:${t.version}`);
              dispatch({ type: "server", task: t });
            })
          }
        />
      )}
      {newTask && (
        <NewTaskDialog
          ctx={ctx}
          initialColumnId={newTask.columnId}
          initialDueDate={newTask.dueDate}
          onClose={() => setNewTask(null)}
          onCreated={(t) => {
            ownWrites.current.add(`${t.id}:${t.version}`);
            dispatch({ type: "server", task: t });
            flashTask(t.id);
          }}
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
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: DONE_COLOR }} />
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
