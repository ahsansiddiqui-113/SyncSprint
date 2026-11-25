"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { TaskPriority, WorkItemType } from "@/db/schema";
import type { TaskDTO } from "@/lib/realtime-protocol";
import type { ProjectMeta } from "@/server/services/breakdown";
import type { SprintDTO } from "@/server/services/sprints";
import { cn } from "@/lib/utils";
import { PRIORITY_STYLE, PriorityFlag } from "@/components/ui/badge";
import { TYPE_META, TypeIcon, WORK_ITEM_TYPES } from "../task-meta";
import type { TaskPatch, ViewProps } from "./types";

export type SortState = { key: string; dir: "asc" | "desc" } | null;
export type WeekLoad = Map<string, { load: number; capacity: number; status: "ok" | "near" | "over" | "idle" }>;

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const POINTS = [1, 2, 3, 5, 8, 13];

/** Assignee option text with this week's load, so overload is visible BEFORE assigning. */
export function loadHint(userId: string, weekLoad: WeekLoad | undefined) {
  const w = weekLoad?.get(userId);
  if (!w || w.capacity === 0) return "";
  const tag = w.status === "over" ? " · over" : w.status === "near" ? " · near" : "";
  return ` — ${Math.round(w.load)}/${Math.round(w.capacity)}h this week${tag}`;
}

/** Comparable value for a sort key (built-in or "field:<id>"). */
export function sortValue(t: TaskDTO, key: string, ctx: { columnIndex: Map<string, number>; memberName: (id: string | null) => string; meta: ProjectMeta }): string | number {
  switch (key) {
    case "ref": return t.taskNumber;
    case "title": return t.title.toLowerCase();
    case "status": return ctx.columnIndex.get(t.columnId) ?? 0;
    case "assignee": return ctx.memberName(t.assigneeId).toLowerCase() || "￿";
    case "priority": return PRIORITY_RANK[t.priority];
    case "dueDate": return t.dueDate ?? "9999-12-31";
    case "estimateHours": return t.estimateHours ?? Number.POSITIVE_INFINITY;
    case "storyPoints": return t.storyPoints ?? Number.POSITIVE_INFINITY;
    case "type": return WORK_ITEM_TYPES.indexOf(t.type);
    case "updatedAt": return t.updatedAt;
    default:
      if (key.startsWith("field:")) {
        const v = ctx.meta.fieldValues[t.id]?.[key.slice(6)];
        return v === undefined ? "￿" : typeof v === "number" ? v : String(v).toLowerCase();
      }
      return 0;
  }
}

export function sortTasks(list: TaskDTO[], sort: SortState, ctx: Parameters<typeof sortValue>[2]) {
  if (!sort) return list;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = sortValue(a, sort.key, ctx);
    const y = sortValue(b, sort.key, ctx);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.taskNumber - b.taskNumber;
  });
}

type Props = ViewProps & {
  meta: ProjectMeta;
  sprints: SprintDTO[];
  sort: SortState;
  onSort: (s: SortState) => void;
  weekLoad: WeekLoad;
  onPatch: (task: TaskDTO, patch: TaskPatch) => void;
  onStatus: (task: TaskDTO, columnId: string) => void;
  onFieldValue: (taskId: string, fieldId: string, value: string | number | null) => void;
};

export function TableView(props: Props) {
  const { columns, meta, canEdit } = props;
  const columnIndex = useMemo(() => new Map(columns.map((c, i) => [c.id, i])), [columns]);
  const memberName = (id: string | null) => (id ? (props.memberById.get(id)?.name ?? "") : "");
  const rows = useMemo(
    () => sortTasks(Object.values(props.tasks).sort((a, b) => a.taskNumber - b.taskNumber), props.sort, { columnIndex, memberName, meta }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.tasks, props.sort, columnIndex, meta]
  );

  const headers: { key: string; label: string; width: number }[] = [
    { key: "type", label: "Type", width: 104 },
    { key: "ref", label: "ID", width: 84 },
    { key: "title", label: "Name", width: 320 },
    { key: "status", label: "Status", width: 150 },
    { key: "assignee", label: "Assignee", width: 190 },
    { key: "priority", label: "Priority", width: 120 },
    { key: "dueDate", label: "Due", width: 150 },
    { key: "estimateHours", label: "Estimate", width: 104 },
    { key: "storyPoints", label: "Points", width: 88 },
    { key: "sprint", label: "Sprint", width: 150 },
    ...meta.fields.map((f) => ({ key: `field:${f.id}`, label: f.name, width: f.type === "text" ? 200 : 150 })),
  ];
  const cycleSort = (key: string) => {
    if (key === "sprint") return;
    if (props.sort?.key !== key) props.onSort({ key, dir: "asc" });
    else if (props.sort.dir === "asc") props.onSort({ key, dir: "desc" });
    else props.onSort(null);
  };
  const cell = "border-b border-r border-border px-2 py-1.5 text-[14px] align-middle";
  const ctl = "w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[14px] outline-none hover:border-border-strong focus:border-primary focus:bg-white disabled:cursor-default disabled:hover:border-transparent";

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-white">
      <table className="min-w-max border-separate border-spacing-0">
        <thead className="sticky top-0 z-10">
          <tr>
            {headers.map((h, i) => {
              const active = props.sort?.key === h.key;
              const Icon = !active ? ArrowUpDown : props.sort!.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={h.key}
                  style={{ width: h.width, minWidth: h.width }}
                  className={cn("border-b border-r border-border bg-surface-2 px-3 py-2 text-left text-[12.5px] font-semibold uppercase tracking-wide text-subtle", i === 2 && "sticky left-0 z-20")}
                  aria-sort={active ? (props.sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  <button onClick={() => cycleSort(h.key)} disabled={h.key === "sprint"} className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground disabled:cursor-default">
                    {h.label}
                    {h.key !== "sprint" && <Icon className={cn("h-3.5 w-3.5", !active && "opacity-40")} />}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const ci = columnIndex.get(t.columnId) ?? 0;
            const color = props.colorOf(ci);
            return (
              <tr key={t.id} className={cn("hover:bg-[#fafafe]", props.flash[t.id] && "animate-flash")}>
                <td className={cell}>
                  <span className="flex items-center gap-1.5">
                    <TypeIcon type={t.type} size={16} />
                    <select aria-label="Type" disabled={!canEdit} value={t.type} onChange={(e) => props.onPatch(t, { type: e.target.value as WorkItemType })} className={ctl}>
                      {WORK_ITEM_TYPES.map((x) => <option key={x} value={x}>{TYPE_META[x].label}</option>)}
                    </select>
                  </span>
                </td>
                <td className={cn(cell, "text-subtle")}>
                  <button onClick={() => props.onOpen(t.id)} className="cursor-pointer hover:text-primary">{props.refOf(t)}</button>
                </td>
                <td className={cn(cell, "sticky left-0 z-[1] bg-white")}>
                  <TitleCell task={t} disabled={!canEdit} onSave={(title) => props.onPatch(t, { title })} onOpen={() => props.onOpen(t.id)} />
                </td>
                <td className={cell}>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <select aria-label="Status" disabled={!canEdit} value={t.columnId} onChange={(e) => props.onStatus(t, e.target.value)} className={ctl}>
                      {columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </span>
                </td>
                <td className={cell}>
                  <select aria-label="Assignee" disabled={!canEdit} value={t.assigneeId ?? ""} onChange={(e) => props.onPatch(t, { assigneeId: e.target.value || null })} className={ctl}>
                    <option value="">Unassigned</option>
                    {[...props.memberById.values()].map((m) => (
                      <option key={m.id} value={m.id}>{m.name}{loadHint(m.id, props.weekLoad)}</option>
                    ))}
                  </select>
                </td>
                <td className={cell}>
                  <span className="flex items-center gap-1">
                    <PriorityFlag priority={t.priority} size={14} />
                    <select aria-label="Priority" disabled={!canEdit} value={t.priority} onChange={(e) => props.onPatch(t, { priority: e.target.value as TaskPriority })} className={ctl}>
                      {(["urgent", "high", "medium", "low"] as const).map((p) => <option key={p} value={p}>{PRIORITY_STYLE[p].label}</option>)}
                    </select>
                  </span>
                </td>
                <td className={cell}>
                  <input
                    type="date"
                    aria-label="Due date"
                    disabled={!canEdit}
                    value={t.dueDate ?? ""}
                    min={t.startDate ?? undefined}
                    onChange={(e) => props.onPatch(t, { dueDate: e.target.value || null })}
                    className={ctl}
                  />
                </td>
                <td className={cell}>
                  <NumberCell
                    value={t.estimateHours}
                    step={0.25}
                    suffix="h"
                    disabled={!canEdit}
                    label="Estimate in hours"
                    onSave={(v) => props.onPatch(t, { estimateHours: v === null ? null : Math.round(v * 4) / 4 })}
                  />
                </td>
                <td className={cell}>
                  <select aria-label="Story points" disabled={!canEdit} value={t.storyPoints ?? ""} onChange={(e) => props.onPatch(t, { storyPoints: e.target.value === "" ? null : Number(e.target.value) })} className={ctl}>
                    <option value="">—</option>
                    {POINTS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td className={cell}>
                  <select aria-label="Sprint" disabled={!canEdit} value={t.sprintId ?? ""} onChange={(e) => props.onPatch(t, { sprintId: e.target.value || null })} className={ctl}>
                    <option value="">Backlog</option>
                    {props.sprints
                      .filter((s) => s.status !== "completed" || s.id === t.sprintId)
                      .map((s) => <option key={s.id} value={s.id} disabled={s.status === "completed"}>{s.name}</option>)}
                  </select>
                </td>
                {meta.fields.map((f) => (
                  <td key={f.id} className={cell}>
                    <FieldEditor field={f} value={meta.fieldValues[t.id]?.[f.id]} disabled={!canEdit} members={[...props.memberById.values()]} onSave={(v) => props.onFieldValue(t.id, f.id, v)} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="px-8 py-10 text-center text-[15px] text-subtle">No tasks match the current filters.</p>}
    </div>
  );
}

function TitleCell({ task, disabled, onSave, onOpen }: { task: TaskDTO; disabled: boolean; onSave: (t: string) => void; onOpen: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={onOpen} className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium hover:text-primary">{task.title}</button>
        {!disabled && (
          <button onClick={() => setDraft(task.title)} className="shrink-0 cursor-pointer rounded px-1 text-[12px] text-subtle opacity-0 hover:bg-hover group-hover:opacity-100 [tr:hover_&]:opacity-100">
            Rename
          </button>
        )}
      </div>
    );
  }
  const commit = () => {
    const v = draft.trim();
    setDraft(null);
    if (v && v !== task.title) onSave(v);
  };
  return (
    <input
      autoFocus
      aria-label="Task name"
      value={draft}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
      className="w-full rounded-md border border-primary px-1.5 py-1 text-[14px] outline-none"
    />
  );
}

function NumberCell({ value, step, suffix, disabled, label, onSave }: { value: number | null; step: number; suffix: string; disabled: boolean; label: string; onSave: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? "" : String(value));
  return (
    <div className="flex items-center">
      <input
        type="number"
        aria-label={label}
        min={0}
        step={step}
        disabled={disabled}
        value={shown}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const v = draft.trim() === "" ? null : Number(draft);
          setDraft(null);
          if (v !== value && (v === null || Number.isFinite(v))) onSave(v);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right text-[14px] tabular-nums outline-none hover:border-border-strong focus:border-primary focus:bg-white disabled:hover:border-transparent"
      />
      {shown !== "" && <span className="pl-0.5 text-[13px] text-subtle">{suffix}</span>}
    </div>
  );
}

/** Inline editor for a custom field value (shared by the table and the task drawer). */
export function FieldEditor({
  field,
  value,
  disabled,
  members,
  onSave,
}: {
  field: ProjectMeta["fields"][number];
  value: string | number | undefined;
  disabled: boolean;
  members: { id: string; name: string }[];
  onSave: (v: string | number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ctl = "w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[14px] outline-none hover:border-border-strong focus:border-primary focus:bg-white disabled:cursor-default disabled:hover:border-transparent";
  switch (field.type) {
    case "select": {
      const opt = field.options.find((o) => o.id === value);
      return (
        <span className="flex items-center gap-1.5">
          {opt && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: opt.color }} />}
          <select aria-label={field.name} disabled={disabled} value={(value as string) ?? ""} onChange={(e) => onSave(e.target.value || null)} className={ctl}>
            <option value="">—</option>
            {field.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </span>
      );
    }
    case "person":
      return (
        <select aria-label={field.name} disabled={disabled} value={(value as string) ?? ""} onChange={(e) => onSave(e.target.value || null)} className={ctl}>
          <option value="">—</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      );
    case "date":
      return <input type="date" aria-label={field.name} disabled={disabled} value={(value as string) ?? ""} onChange={(e) => onSave(e.target.value || null)} className={ctl} />;
    case "number":
      return <NumberCell value={typeof value === "number" ? value : null} step={1} suffix="" disabled={disabled} label={field.name} onSave={onSave} />;
    default: {
      const shown = draft ?? ((value as string) ?? "");
      return (
        <input
          aria-label={field.name}
          disabled={disabled}
          value={shown}
          maxLength={500}
          placeholder="—"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft === null) return;
            const v = draft.trim();
            setDraft(null);
            if (v !== (value ?? "")) onSave(v || null);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={ctl}
        />
      );
    }
  }
}
