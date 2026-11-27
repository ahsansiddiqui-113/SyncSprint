"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight, BrainCircuit, Circle, CornerDownRight, ExternalLink, Hand, ListTree, Loader2, Maximize, Minus, MousePointer2, Pencil, Plus,
  PresentationIcon, Square, StickyNote, Trash2, Type, ChevronDown, SquareCheckBig,
} from "lucide-react";
import {
  applyBoardOpsAction, convertItemToTaskAction, createBoardAction, deleteBoardAction, getBoardAction, listBoardsAction, mindmapToTasksAction, renameBoardAction,
  type BoardItemDTO,
} from "@/actions/planning.actions";
import type { BoardOp } from "@/server/services/whiteboards";
import type { TaskDTO } from "@/lib/realtime-protocol";
import { todayISO } from "@/lib/dates";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSignal, useVisiblePoll } from "@/components/workspace/signals";

/**
 * Whiteboards and mind maps for a project.
 *  - whiteboard: sticky notes, shapes, text, arrows and live task cards on an infinite canvas
 *  - mind map: a tree laid out automatically; Tab adds a child, Enter a sibling; a branch can become tasks
 * Changes are sent as small batches with each item's version, so two people dragging the same
 * note never silently overwrite each other. Other people's changes arrive as WHITEBOARD_CHANGED
 * (or by polling when there is no live connection).
 */

type BoardListRow = { id: string; name: string; kind: "whiteboard" | "mindmap"; revision: number; updatedAt: string; createdById: string | null; items: number };
type LinkedTask = { id: string; ref: string; title: string; column: string; priority: string; assignee: string | null; dueDate: string | null };
type Item = BoardItemDTO;

type Props = {
  organizationId: string;
  projectId: string;
  me: { id: string };
  canEdit: boolean;
  isAdmin: boolean;
  allTasks: Record<string, TaskDTO>;
  refOf: (t: { taskNumber: number }) => string;
  onOpen: (taskId: string) => void;
};

export function WhiteboardsView(props: Props) {
  const { organizationId, projectId } = props;
  const [boards, setBoards] = useState<BoardListRow[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listBoardsAction(organizationId, projectId);
    if (!r.ok) return void toast.error(r.message);
    setBoards(r.boards);
    setCurrent((c) => (c && r.boards.some((b) => b.id === c) ? c : (r.boards[0]?.id ?? null)));
  }, [organizationId, projectId]);
  useEffect(() => void load(), [load]);
  // Any change (ours included) refreshes names, item counts and "updated" times; debounced so a burst is one fetch.
  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSignal((e) => {
    if (e.type !== "WHITEBOARD_CHANGED" || e.projectId !== projectId) return;
    if (listTimer.current) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => void load(), 800);
  });
  useEffect(() => () => void (listTimer.current && clearTimeout(listTimer.current)), []);

  async function create(kind: "whiteboard" | "mindmap") {
    const name = window.prompt(kind === "mindmap" ? "Name the mind map (it becomes the central idea)" : "Name the whiteboard", kind === "mindmap" ? "Release ideas" : "Planning board");
    if (!name?.trim()) return;
    const r = await createBoardAction(organizationId, projectId, name.trim(), kind);
    if (!r.ok) return void toast.error(r.message);
    await load();
    setCurrent(r.id);
  }

  const board = boards?.find((b) => b.id === current) ?? null;

  return (
    <div className="flex min-h-0 flex-1 bg-white">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-subtle">Boards</h2>
        </div>
        {props.canEdit && (
          <div className="flex gap-2 px-4 pb-3">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => create("whiteboard")}><PresentationIcon className="h-4 w-4" /> Board</Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => create("mindmap")}><BrainCircuit className="h-4 w-4" /> Mind map</Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {boards === null ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-subtle" /></div>
          ) : boards.length === 0 ? (
            <p className="px-2 py-4 text-[14px] text-muted">No boards yet.{props.canEdit ? " Start a whiteboard to sketch, or a mind map to break an idea down into tasks." : ""}</p>
          ) : (
            boards.map((b) => (
              <button
                key={b.id}
                onClick={() => setCurrent(b.id)}
                className={cn("flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left", b.id === current ? "bg-primary-soft text-primary" : "hover:bg-hover")}
              >
                {b.kind === "mindmap" ? <BrainCircuit className="mt-0.5 h-4 w-4 shrink-0" /> : <PresentationIcon className="mt-0.5 h-4 w-4 shrink-0" />}
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-medium">{b.name}</span>
                  <span className="text-[12px] text-subtle">{b.items} item{b.items === 1 ? "" : "s"} · {timeAgo(b.updatedAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </aside>
      {board ? (
        <Canvas
          key={board.id}
          {...props}
          listRow={board}
          onRenamed={load}
          onDeleted={async () => {
            setCurrent(null);
            await load();
          }}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[15px] text-muted">{boards?.length ? "Pick a board" : ""}</div>
      )}
    </div>
  );
}

/* ================================== canvas ================================== */

type Tool = "select" | "hand" | "note" | "rect" | "ellipse" | "text" | "arrow";
const FILLS = ["#fff4b8", "#fecaca", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#fbcfe8", "#e5e7eb", "#ffffff"];
const ACCENTS = ["#7b68ee", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#64748b"];
const DEFAULTS: Record<"note" | "rect" | "ellipse" | "text" | "task", { w: number; h: number; color: string }> = {
  note: { w: 180, h: 140, color: "#fff4b8" },
  rect: { w: 180, h: 110, color: "#bfdbfe" },
  ellipse: { w: 170, h: 110, color: "#bbf7d0" },
  text: { w: 240, h: 44, color: "#ffffff" },
  task: { w: 250, h: 96, color: "#ffffff" },
};
const NODE_W = 190;
const NODE_H = 46;
const GAP_X = 70;
const GAP_Y = 14;

type View = { x: number; y: number; k: number };
type Drag =
  | { mode: "move"; ids: string[]; sx: number; sy: number; orig: Map<string, { x: number; y: number }>; moved: boolean }
  | { mode: "resize"; id: string; sx: number; sy: number; w: number; h: number }
  | { mode: "pan"; sx: number; sy: number; vx: number; vy: number };

function Canvas(props: Props & { listRow: BoardListRow; onRenamed: () => void; onDeleted: () => void }) {
  const { organizationId, listRow } = props;
  const isMap = listRow.kind === "mindmap";
  const [items, setItems] = useState<Map<string, Item>>(new Map());
  const [linked, setLinked] = useState<Map<string, LinkedTask>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>({ x: 80, y: 80, k: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [arrowFrom, setArrowFrom] = useState<string | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => ((dragRef.current = d), setDragState(d));
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const revision = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const wrap = useRef<HTMLDivElement>(null);
  const centred = useRef(false);

  /* ------------------------------- load + sync ------------------------------- */
  const reload = useCallback(async () => {
    if (dragRef.current) return; // never yank items out from under a drag
    const r = await getBoardAction(organizationId, listRow.id);
    if (!r.ok) return void toast.error(r.message);
    revision.current = r.board.revision;
    setItems(new Map(r.items.map((i) => [i.id, i])));
    setLinked(new Map(r.tasks.map((t) => [t.id, t])));
    setLoaded(true);
  }, [organizationId, listRow.id]);
  useEffect(() => void reload(), [reload]);
  useSignal((e) => {
    if (e.type === "WHITEBOARD_CHANGED" && e.boardId === listRow.id && (e.revision === null || e.revision > revision.current)) void reload();
    if ((e.type === "TASK_UPDATED" && linked.has(e.task.id)) || e.type === "TASK_DELETED") void reload();
  });
  useVisiblePoll(() => {
    // Cheap check: the list row carries the revision; refetch only if someone else changed it.
    void (async () => {
      const r = await listBoardsAction(organizationId, props.projectId);
      const row = r.ok ? r.boards.find((b) => b.id === listRow.id) : null;
      if (row && row.revision > revision.current) void reload();
    })();
  }, 15_000);

  /** Send a batch built from the latest state when its turn comes (so versions are never stale locally). */
  const send = useCallback((build: () => BoardOp[]) => {
    queue.current = queue.current.then(async () => {
      const ops = build();
      if (!ops.length) return;
      const r = await applyBoardOpsAction(organizationId, listRow.id, ops);
      if (!r.ok) {
        toast.error(r.message);
        return void (await reload());
      }
      revision.current = r.revision;
      setItems((prev) => {
        const next = new Map(prev);
        r.changed.forEach((i) => next.set(i.id, i));
        r.conflicts.forEach((i) => next.set(i.id, i));
        r.deleted.forEach((id) => next.delete(id));
        return next;
      });
      if (r.conflicts.length) toast.message("Someone else changed that at the same time; showing their version.");
      return r;
    });
    return queue.current as Promise<Awaited<ReturnType<typeof applyBoardOpsAction>> | undefined>;
  }, [organizationId, listRow.id, reload]);

  const update = (id: string, fields: Partial<Item>) => {
    setItems((prev) => {
      const cur = prev.get(id);
      if (!cur) return prev;
      return new Map(prev).set(id, { ...cur, ...fields });
    });
    void send(() => {
      const cur = itemsRef.current.get(id);
      return cur ? [{ op: "update", id, version: cur.version, fields: pickFields(fields) }] : [];
    });
  };
  const remove = (id: string) => {
    const it = items.get(id);
    if (!it || (isMap && !it.parentId)) return;
    setSelected(null);
    void send(() => [{ op: "delete", id }]);
  };
  const create = async (kind: Item["kind"], fields: Partial<Item>) => {
    const z = Math.max(0, ...[...items.values()].map((i) => i.z)) + 1;
    const r = await send(() => [{ op: "create", kind, fields: { z, ...pickFields(fields) } }]);
    const made = r && r.ok ? r.changed[0] : undefined;
    return made;
  };

  /* --------------------------------- layout --------------------------------- */
  const layout = useMemo(() => (isMap ? mindmapLayout(items) : null), [isMap, items]);
  const boxOf = useCallback((it: Item) => (layout?.get(it.id) ?? { x: it.x, y: it.y, w: it.w, h: it.h }), [layout]);

  // Centre the content once it's loaded.
  useEffect(() => {
    if (!loaded || centred.current || !wrap.current) return;
    centred.current = true;
    const boxes = [...items.values()].filter((i) => i.kind !== "arrow" && (!layout || layout.has(i.id))).map(boxOf);
    if (!boxes.length) return;
    const r = wrap.current.getBoundingClientRect();
    const minX = Math.min(...boxes.map((b) => b.x)), minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w)), maxY = Math.max(...boxes.map((b) => b.y + b.h));
    const k = Math.min(1, Math.max(0.3, Math.min((r.width - 120) / (maxX - minX || 1), (r.height - 120) / (maxY - minY || 1))));
    setView({ k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k });
  }, [loaded, items, layout, boxOf]);

  /* ------------------------------ pointer input ------------------------------ */
  const toWorld = (cx: number, cy: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.mode === "pan") return setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
      const dx = (e.clientX - d.sx) / view.k, dy = (e.clientY - d.sy) / view.k;
      if (d.mode === "move") {
        if (!d.moved && Math.hypot(dx, dy) < 3) return;
        d.moved = true;
        setItems((prev) => {
          const next = new Map(prev);
          for (const id of d.ids) {
            const o = d.orig.get(id)!, cur = next.get(id);
            if (cur) next.set(id, { ...cur, x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
          }
          return next;
        });
      } else {
        setItems((prev) => {
          const cur = prev.get(d.id);
          return cur ? new Map(prev).set(d.id, { ...cur, w: Math.max(40, Math.round(d.w + dx)), h: Math.max(30, Math.round(d.h + dy)) }) : prev;
        });
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || d.mode === "pan") return;
      if (d.mode === "move" && d.moved) {
        void send(() => d.ids.flatMap((id) => {
          const cur = itemsRef.current.get(id);
          return cur ? [{ op: "update" as const, id, version: cur.version, fields: { x: cur.x, y: cur.y } }] : [];
        }));
      } else if (d.mode === "resize") {
        void send(() => {
          const cur = itemsRef.current.get(d.id);
          return cur ? [{ op: "update", id: d.id, version: cur.version, fields: { w: cur.w, h: cur.h } }] : [];
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.mode, view.k]);

  // Wheel zooms around the cursor (non-passive so the page doesn't scroll).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      setView((v) => {
        if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) + Math.abs(e.deltaY) < 40 && e.deltaMode === 0 && !Number.isInteger(e.deltaY)) {
          return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }; // trackpad two-finger pan
        }
        const k = Math.min(2.5, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [loaded]);

  const zoomBy = (f: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const px = r.width / 2, py = r.height / 2;
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.2, v.k * f));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };
  const fit = () => {
    centred.current = false;
    setItems((m) => new Map(m)); // re-run the centring effect
  };

  async function onBackgroundDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    setEditing(null);
    if (!isMap && props.canEdit && (tool === "note" || tool === "rect" || tool === "ellipse" || tool === "text")) {
      const p = toWorld(e.clientX, e.clientY);
      const d = DEFAULTS[tool];
      const made = await create(tool, { x: Math.round(p.x - d.w / 2), y: Math.round(p.y - d.h / 2), w: d.w, h: d.h, color: d.color, text: "" });
      setTool("select");
      if (made) {
        setSelected(made.id);
        setEditing(made.id);
      }
      return;
    }
    setSelected(null);
    setArrowFrom(null);
    setDrag({ mode: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
  }

  function onItemDown(e: React.PointerEvent, it: Item) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing === it.id) return;
    if (tool === "hand") return setDrag({ mode: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
    if (tool === "arrow" && props.canEdit) {
      if (!arrowFrom) return setArrowFrom(it.id);
      if (arrowFrom !== it.id) void create("arrow", { fromId: arrowFrom, toId: it.id, color: "#64748b" });
      setArrowFrom(null);
      return setTool("select");
    }
    setSelected(it.id);
    if (!props.canEdit || isMap) return;
    setDrag({ mode: "move", ids: [it.id], sx: e.clientX, sy: e.clientY, orig: new Map([[it.id, { x: it.x, y: it.y }]]), moved: false });
  }

  /* -------------------------------- mind map -------------------------------- */
  async function addNode(parentId: string) {
    const parent = items.get(parentId);
    if (!parent) return;
    if (parent.collapsed) update(parentId, { collapsed: false });
    const siblings = [...items.values()].filter((i) => i.parentId === parentId);
    const y = Math.max(-1, ...siblings.map((s) => s.y)) + 1; // y keeps sibling order in a mind map
    const made = await create("node", { parentId, text: "", y, color: parent.parentId ? parent.color : ACCENTS[siblings.length % ACCENTS.length]!, w: NODE_W, h: NODE_H });
    if (made) {
      setSelected(made.id);
      setEditing(made.id);
    }
  }
  async function branchToTasks(id: string) {
    setBusy(true);
    const r = await mindmapToTasksAction(organizationId, id, todayISO());
    setBusy(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success(r.created ? `Created ${r.created} task${r.created === 1 ? "" : "s"} (branches become parents, ideas below them subtasks)` : "Everything here is already a task");
    await reload();
  }
  async function toTask(id: string) {
    setBusy(true);
    const r = await convertItemToTaskAction(organizationId, id, todayISO());
    setBusy(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success("Task created; this card now shows it live");
    await reload();
  }

  /* -------------------------------- keyboard -------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || !selected || !props.canEdit) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const it = itemsRef.current.get(selected);
      if (!it) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove(selected);
      } else if (e.key === "Escape") setSelected(null);
      else if (e.key === "F2" || (e.key === "Enter" && !isMap)) {
        e.preventDefault();
        if (it.kind !== "arrow") setEditing(selected);
      } else if (isMap && e.key === "Tab") {
        e.preventDefault();
        void addNode(selected);
      } else if (isMap && e.key === "Enter") {
        e.preventDefault();
        void addNode(it.parentId ?? it.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* --------------------------------- render --------------------------------- */
  const all = [...items.values()].sort((a, b) => a.z - b.z);
  const shapes = all.filter((i) => i.kind !== "arrow" && (!layout || layout.has(i.id)));
  const arrows = all.filter((i) => i.kind === "arrow");
  const sel = selected ? items.get(selected) : undefined;
  const root = isMap ? all.find((i) => i.kind === "node" && !i.parentId) : undefined;
  const canDeleteBoard = props.canEdit && (props.isAdmin || listRow.createdById === props.me.id);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
        <h2 className="truncate text-lg font-bold tracking-tight">{listRow.name}</h2>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px] font-medium text-subtle">{isMap ? "Mind map" : "Whiteboard"}</span>
        {props.canEdit && (
          <Button variant="ghost" size="icon" aria-label="Rename board" onClick={async () => {
            const name = window.prompt("Rename board", listRow.name);
            if (!name?.trim() || name.trim() === listRow.name) return;
            const r = await renameBoardAction(organizationId, listRow.id, name.trim());
            if (!r.ok) return void toast.error(r.message);
            props.onRenamed();
          }}><Pencil className="h-4 w-4" /></Button>
        )}
        {canDeleteBoard && (
          <Button variant="ghost" size="icon" aria-label="Delete board" onClick={async () => {
            if (!window.confirm(`Delete "${listRow.name}" and everything on it? Tasks made from it stay.`)) return;
            const r = await deleteBoardAction(organizationId, listRow.id);
            if (!r.ok) return void toast.error(r.message);
            props.onDeleted();
          }}><Trash2 className="h-4 w-4" /></Button>
        )}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-subtle" />}
        <div className="ml-auto flex items-center gap-1">
          {isMap && root && props.canEdit && (
            <Button size="sm" variant="outline" onClick={() => branchToTasks(selected && items.get(selected)?.kind === "node" ? selected : root.id)}>
              <ListTree className="h-4 w-4" /> {selected && selected !== root.id ? "Branch to tasks" : "All branches to tasks"}
            </Button>
          )}
          <Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}><Minus className="h-4 w-4" /></Button>
          <span className="w-12 text-center text-[13px] tabular-nums text-muted">{Math.round(view.k * 100)}%</span>
          <Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => zoomBy(1.2)}><Plus className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Fit to screen" onClick={fit}><Maximize className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {/* tool palette */}
        {!isMap && (
          <div className="absolute left-4 top-4 z-20 flex flex-col gap-1 rounded-xl border border-border bg-white p-1 shadow-card" role="toolbar" aria-label="Whiteboard tools">
            {([
              ["select", MousePointer2, "Select and move (V)"],
              ["hand", Hand, "Pan (H)"],
              ...(props.canEdit ? ([
                ["note", StickyNote, "Sticky note"],
                ["rect", Square, "Rectangle"],
                ["ellipse", Circle, "Ellipse"],
                ["text", Type, "Text"],
                ["arrow", ArrowUpRight, "Arrow: click two items"],
              ] as const) : []),
            ] as const).map(([t, Icon, label]) => (
              <button
                key={t}
                title={label}
                aria-label={label}
                aria-pressed={tool === t}
                onClick={() => (setTool(t as Tool), setArrowFrom(null))}
                className={cn("flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg", tool === t ? "bg-primary text-white" : "text-muted hover:bg-hover hover:text-foreground")}
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            ))}
            {props.canEdit && (
              <button title="Add a task card" aria-label="Add a task card" onClick={() => setPicker((v) => !v)} className={cn("flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg", picker ? "bg-primary text-white" : "text-muted hover:bg-hover hover:text-foreground")}>
                <SquareCheckBig className="h-[18px] w-[18px]" />
              </button>
            )}
          </div>
        )}
        {picker && (
          <TaskPicker
            tasks={props.allTasks}
            refOf={props.refOf}
            onClose={() => setPicker(false)}
            onPick={async (t) => {
              setPicker(false);
              const r = wrap.current!.getBoundingClientRect();
              const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
              const made = await create("task", { taskId: t.id, x: Math.round(c.x - 125), y: Math.round(c.y - 48), w: 250, h: 96, color: "#ffffff", text: "" });
              if (made) {
                setSelected(made.id);
                await reload();
              }
            }}
          />
        )}
        {tool === "arrow" && (
          <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full bg-foreground px-3 py-1 text-[13px] text-white">
            {arrowFrom ? "Now click the item it points to" : "Click the item the arrow starts from"}
          </div>
        )}

        {/* selection toolbar */}
        {sel && props.canEdit && !drag && (
          <div className="absolute right-4 top-4 z-20 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-white p-1.5 shadow-card">
            {sel.kind !== "task" && sel.kind !== "text" && (isMap ? ACCENTS : sel.kind === "arrow" ? ACCENTS : FILLS).map((c) => (
              <button key={c} aria-label={`Colour ${c}`} onClick={() => update(sel.id, { color: c })}
                className={cn("h-6 w-6 cursor-pointer rounded-full border border-black/10", sel.color === c && "ring-2 ring-primary ring-offset-1")} style={{ backgroundColor: c }} />
            ))}
            {isMap && sel.kind === "node" && (
              <>
                <Button size="sm" variant="ghost" onClick={() => addNode(sel.id)} title="Add child (Tab)"><CornerDownRight className="h-4 w-4" /> Child</Button>
                {sel.parentId && <Button size="sm" variant="ghost" onClick={() => addNode(sel.parentId!)} title="Add sibling (Enter)"><Plus className="h-4 w-4" /> Sibling</Button>}
              </>
            )}
            {!isMap && !sel.taskId && sel.kind !== "arrow" && sel.text.trim() && (
              <Button size="sm" variant="ghost" onClick={() => toTask(sel.id)}><SquareCheckBig className="h-4 w-4" /> To task</Button>
            )}
            {sel.taskId && (
              <Button size="sm" variant="ghost" onClick={() => props.onOpen(sel.taskId!)}><ExternalLink className="h-4 w-4" /> Open task</Button>
            )}
            {sel.kind !== "arrow" && sel.kind !== "task" && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(sel.id)}><Pencil className="h-4 w-4" /> Edit</Button>
            )}
            {!(isMap && !sel.parentId) && (
              <Button size="sm" variant="ghost" onClick={() => remove(sel.id)} aria-label="Delete item"><Trash2 className="h-4 w-4 text-rose-600" /></Button>
            )}
          </div>
        )}

        <div
          ref={wrap}
          className={cn("absolute inset-0 touch-none select-none overflow-hidden", tool === "hand" || drag?.mode === "pan" ? "cursor-grab" : tool !== "select" ? "cursor-crosshair" : "")}
          style={{ backgroundColor: "#fafafa", backgroundImage: "radial-gradient(#d4d4d8 1px, transparent 1px)", backgroundSize: `${22 * view.k}px ${22 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
          onPointerDown={onBackgroundDown}
          data-testid="board-canvas"
        >
          {!loaded && <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-subtle" /></div>}
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            {/* connectors */}
            <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1} aria-hidden={isMap}>
              <defs>
                <marker id="wb-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
                </marker>
              </defs>
              {isMap && layout && [...items.values()].filter((n) => n.parentId && layout.has(n.id) && layout.has(n.parentId)).map((n) => {
                const a = layout.get(n.parentId!)!, b = layout.get(n.id)!;
                const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
                return <path key={n.id} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={n.color} strokeWidth={2.5} strokeLinecap="round" opacity={0.8} />;
              })}
              {arrows.map((a) => {
                const f = a.fromId ? items.get(a.fromId) : undefined, t = a.toId ? items.get(a.toId) : undefined;
                if (!f || !t) return null;
                const [p1, p2] = connect(boxOf(f), boxOf(t));
                const d = `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
                return (
                  <g key={a.id} style={{ pointerEvents: "auto" }} className="cursor-pointer" onPointerDown={(e) => { e.stopPropagation(); setSelected(a.id); }}>
                    <path d={d} stroke="transparent" strokeWidth={14} fill="none" />
                    <path d={d} stroke={a.color} strokeWidth={selected === a.id ? 3.5 : 2.25} fill="none" markerEnd="url(#wb-head)" />
                  </g>
                );
              })}
            </svg>

            {shapes.map((it) => {
              const b = boxOf(it);
              const task = it.taskId ? linked.get(it.taskId) : undefined;
              const isSel = selected === it.id;
              const children = isMap ? [...items.values()].filter((c) => c.parentId === it.id).length : 0;
              return (
                <div
                  key={it.id}
                  data-item={it.kind}
                  onPointerDown={(e) => onItemDown(e, it)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (!props.canEdit) return;
                    if (it.kind === "task" && it.taskId) props.onOpen(it.taskId);
                    else setEditing(it.id);
                  }}
                  className={cn(
                    "absolute flex",
                    it.kind === "note" && "rounded-sm p-3 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.25)]",
                    it.kind === "rect" && "rounded-lg border-2 p-3",
                    it.kind === "ellipse" && "items-center justify-center rounded-[50%] border-2 p-5 text-center",
                    it.kind === "text" && "p-1",
                    it.kind === "task" && "flex-col rounded-xl border border-border bg-white p-3 shadow-card",
                    it.kind === "node" && "items-center rounded-xl border-2 bg-white px-3 shadow-card",
                    isSel && "outline outline-2 outline-offset-2 outline-primary",
                    arrowFrom === it.id && "outline outline-2 outline-offset-2 outline-amber-500",
                    props.canEdit && !isMap && tool === "select" ? "cursor-move" : "cursor-pointer"
                  )}
                  style={{
                    left: b.x, top: b.y, width: b.w, height: b.h,
                    backgroundColor: it.kind === "note" ? it.color : it.kind === "rect" || it.kind === "ellipse" ? `${it.color}` : undefined,
                    borderColor: it.kind === "rect" || it.kind === "ellipse" ? shade(it.color) : it.kind === "node" ? it.color : undefined,
                    ...(it.kind === "node" && !it.parentId ? { backgroundColor: it.color, color: "white" } : {}),
                  }}
                >
                  {editing === it.id ? (
                    <InlineText
                      initial={it.text}
                      big={it.kind === "text"}
                      onDone={(text) => {
                        setEditing(null);
                        if (text !== it.text) update(it.id, { text });
                      }}
                    />
                  ) : it.kind === "task" ? (
                    task ? (
                      <>
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-subtle">
                          <SquareCheckBig className="h-3.5 w-3.5 text-primary" /> {task.ref} <span className="ml-auto rounded bg-surface-2 px-1.5 py-0.5 font-medium">{task.column}</span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-[14px] font-semibold leading-snug">{task.title}</div>
                        <div className="mt-auto text-[12px] text-subtle">{task.assignee ?? "Unassigned"}{task.dueDate ? ` · due ${task.dueDate}` : ""}</div>
                      </>
                    ) : <div className="m-auto text-[13px] text-subtle">Task removed</div>
                  ) : (
                    <>
                      <div className={cn(
                        "min-w-0 flex-1 whitespace-pre-wrap break-words",
                        it.kind === "text" ? "text-[20px] font-semibold" : it.kind === "node" ? "truncate text-[14.5px] font-semibold" : "text-[14.5px] leading-snug",
                        !it.text && "text-black/35"
                      )}>
                        {it.text || (props.canEdit ? (it.kind === "node" ? "New idea" : "Double-click to write") : "")}
                      </div>
                      {task && (
                        <span className={cn("ml-2 shrink-0 self-start rounded px-1.5 py-0.5 text-[11px] font-bold", it.kind === "node" && !it.parentId ? "bg-white/25" : "bg-primary-soft text-primary")} title={`${task.title} · ${task.column}`}>
                          {task.ref}
                        </span>
                      )}
                      {isMap && children > 0 && (
                        <button
                          aria-label={it.collapsed ? "Expand" : "Collapse"}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => props.canEdit ? update(it.id, { collapsed: !it.collapsed }) : undefined}
                          className="absolute -right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-white text-[11px] font-bold text-muted shadow-card"
                        >
                          {it.collapsed ? <span>{children}</span> : <ChevronDown className="h-3.5 w-3.5 -rotate-90" />}
                        </button>
                      )}
                    </>
                  )}
                  {isSel && props.canEdit && !isMap && it.kind !== "task" && (
                    <span
                      aria-hidden
                      className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-primary bg-white"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setDrag({ mode: "resize", id: it.id, sx: e.clientX, sy: e.clientY, w: it.w, h: it.h });
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {loaded && !shapes.length && !isMap && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] text-muted">
              {props.canEdit ? "Pick a sticky note or shape on the left, then click anywhere to place it." : "This board is empty."}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/90 px-3 py-1 text-[12.5px] text-subtle shadow-card">
          {isMap ? "Tab: add child · Enter: add sibling · F2: rename · Delete: remove branch · scroll to zoom, drag to pan" : "Double-click to write · Delete removes · scroll to zoom, drag the background to pan"}
        </div>
      </div>
    </div>
  );
}

/* ================================== helpers ================================== */

function pickFields(f: Partial<Item>) {
  const out: Record<string, unknown> = {};
  for (const k of ["x", "y", "w", "h", "text", "color", "fromId", "toId", "parentId", "taskId", "z", "collapsed"] as const) if (k in f) out[k] = f[k];
  return out as BoardOp extends infer O ? O extends { op: "create"; fields: infer F } ? F : never : never;
}

/** Darker border for a fill colour. */
function shade(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.round(v * 0.72)).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** Endpoints of a straight connector between two boxes, clipped to their borders. */
function connect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const clip = (c: { x: number; y: number }, box: typeof a, toward: { x: number; y: number }) => {
    const dx = toward.x - c.x, dy = toward.y - c.y;
    if (!dx && !dy) return c;
    const t = Math.min(dx ? box.w / 2 / Math.abs(dx) : Infinity, dy ? box.h / 2 / Math.abs(dy) : Infinity);
    return { x: c.x + dx * Math.min(1, t + 0.02), y: c.y + dy * Math.min(1, t + 0.02) };
  };
  return [clip(ca, a, cb), clip(cb, b, ca)] as const;
}

/** Left-to-right tree layout: each subtree takes the height of its children; parents centre on them. */
function mindmapLayout(items: Map<string, Item>) {
  const nodes = [...items.values()].filter((i) => i.kind === "node");
  const kids = new Map<string, Item[]>();
  for (const n of nodes) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  for (const list of kids.values()) list.sort((a, b) => a.y - b.y || a.z - b.z);
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  const heights = new Map<string, number>();
  const height = (n: Item): number => {
    const c = n.collapsed ? [] : (kids.get(n.id) ?? []);
    const h = c.length ? Math.max(NODE_H, c.reduce((s, k) => s + height(k), 0) + GAP_Y * (c.length - 1)) : NODE_H;
    heights.set(n.id, h);
    return h;
  };
  const place = (n: Item, depth: number, top: number) => {
    const h = heights.get(n.id)!;
    const w = Math.max(NODE_W, Math.min(340, 28 + n.text.length * 8.6 + (n.taskId ? 64 : 0) + (kids.get(n.id)?.length ? 12 : 0)));
    const x = depth === 0 ? 0 : depth * (NODE_W + GAP_X) + 40;
    out.set(n.id, { x, y: top + h / 2 - NODE_H / 2, w: depth === 0 ? Math.max(w, 200) : w, h: NODE_H });
    if (n.collapsed) return;
    let y = top;
    for (const k of kids.get(n.id) ?? []) {
      place(k, depth + 1, y);
      y += heights.get(k.id)! + GAP_Y;
    }
  };
  let top = 0;
  for (const r of nodes.filter((n) => !n.parentId)) {
    height(r);
    place(r, 0, top);
    top += heights.get(r.id)! + 60;
  }
  return out;
}

function InlineText({ initial, onDone, big }: { initial: string; onDone: (text: string) => void; big?: boolean }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      aria-label="Text"
      value={v}
      maxLength={2000}
      onChange={(e) => setV(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onDone(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onDone(initial);
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onDone(v);
        }
      }}
      className={cn("h-full w-full resize-none bg-transparent leading-snug outline-none", big ? "text-[20px] font-semibold" : "text-[14.5px]")}
    />
  );
}

function TaskPicker({ tasks, refOf, onPick, onClose }: { tasks: Record<string, TaskDTO>; refOf: (t: { taskNumber: number }) => string; onPick: (t: TaskDTO) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = Object.values(tasks)
    .filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()) || refOf(t).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.taskNumber - a.taskNumber)
    .slice(0, 30);
  return (
    <div className="absolute left-16 top-4 z-30 w-80 rounded-xl border border-border bg-white p-2 shadow-lift">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} placeholder="Find a task…" aria-label="Find a task"
        className="mb-1 h-9 w-full rounded-lg border border-border px-2.5 text-[14px] outline-none focus:border-primary" />
      <div className="max-h-72 overflow-y-auto">
        {list.length ? list.map((t) => (
          <button key={t.id} onClick={() => onPick(t)} className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-hover">
            <span className="shrink-0 text-[12px] font-semibold text-subtle">{refOf(t)}</span>
            <span className="truncate">{t.title}</span>
          </button>
        )) : <p className="px-2 py-3 text-[13.5px] text-muted">No matching tasks</p>}
      </div>
    </div>
  );
}

