"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDownUp, Bookmark, ChevronDown, Layers, Share2, Trash2 } from "lucide-react";
import type { SavedViewConfig } from "@/db/schema";
import type { ProjectMeta } from "@/server/services/breakdown";
import { deleteSavedViewAction, listSavedViewsAction, saveViewAction } from "@/actions/customize.actions";
import { cn } from "@/lib/utils";
import { CheckRow, Popover } from "@/components/ui/popover";
import type { Filters } from "./filters";
import type { SortState } from "./views/table-view";
import type { ViewId } from "./views/types";

export type GroupBy = "status" | "assignee" | "priority" | "type" | "sprint";
type SavedView = { id: string; name: string; config: SavedViewConfig; shared: boolean; mine: boolean };

export const SORT_OPTIONS: { key: string; label: string }[] = [
  { key: "priority", label: "Priority" },
  { key: "dueDate", label: "Due date" },
  { key: "estimateHours", label: "Estimate" },
  { key: "storyPoints", label: "Story points" },
  { key: "title", label: "Name" },
  { key: "updatedAt", label: "Last updated" },
];
const GROUPS: { id: GroupBy; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "assignee", label: "Assignee" },
  { id: "priority", label: "Priority" },
  { id: "type", label: "Type" },
  { id: "sprint", label: "Sprint" },
];

const chip = (active: boolean) =>
  cn(
    "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[14px] font-medium transition-colors",
    active ? "border-primary/40 bg-primary-soft text-primary" : "border-border bg-white text-muted hover:bg-hover hover:text-foreground"
  );

export function ViewsMenu({
  organizationId,
  projectId,
  view,
  filters,
  sort,
  groupBy,
  meta,
  canShare,
  onApply,
  onSort,
  onGroup,
}: {
  organizationId: string;
  projectId: string;
  view: ViewId;
  filters: Filters;
  sort: SortState;
  groupBy: GroupBy;
  meta: ProjectMeta;
  canShare: boolean;
  onApply: (c: SavedViewConfig) => void;
  onSort: (s: SortState) => void;
  onGroup: (g: GroupBy) => void;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    listSavedViewsAction(organizationId, projectId).then((r) => r.ok && setViews(r.views));
  }, [organizationId, projectId]);

  const sortable = view === "list" || view === "table";
  const sortOptions = [...SORT_OPTIONS, ...meta.fields.map((f) => ({ key: `field:${f.id}`, label: f.name }))];
  const sortLabel = sort ? (sortOptions.find((o) => o.key === sort.key)?.label ?? "Custom") : null;

  return (
    <div className="ml-auto flex items-center gap-2">
      {view === "list" && (
        <Popover
          align="right"
          trigger={() => (
            <span className={chip(groupBy !== "status")}>
              <Layers className="h-4 w-4" /> Group: {GROUPS.find((g) => g.id === groupBy)?.label} <ChevronDown className="h-3.5 w-3.5" />
            </span>
          )}
        >
          {GROUPS.map((g) => (
            <CheckRow key={g.id} checked={groupBy === g.id} onChange={() => onGroup(g.id)}>{g.label}</CheckRow>
          ))}
        </Popover>
      )}
      {sortable && (
        <Popover
          align="right"
          trigger={() => (
            <span className={chip(!!sort)}>
              <ArrowDownUp className="h-4 w-4" /> {sortLabel ? `${sortLabel} ${sort!.dir === "asc" ? "↑" : "↓"}` : "Sort"} <ChevronDown className="h-3.5 w-3.5" />
            </span>
          )}
        >
          <CheckRow checked={!sort} onChange={() => onSort(null)}>Default order</CheckRow>
          {sortOptions.map((o) => (
            <CheckRow
              key={o.key}
              checked={sort?.key === o.key}
              onChange={() => onSort(sort?.key === o.key ? { key: o.key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: o.key, dir: "asc" })}
            >
              <span className="flex-1">{o.label}</span>
              {sort?.key === o.key && <span className="text-[12px] text-subtle">{sort.dir === "asc" ? "ascending" : "descending"}</span>}
            </CheckRow>
          ))}
        </Popover>
      )}
      <Popover
        align="right"
        className="w-80"
        trigger={() => (
          <span className={chip(false)}>
            <Bookmark className="h-4 w-4" /> Views{views.length ? ` · ${views.length}` : ""} <ChevronDown className="h-3.5 w-3.5" />
          </span>
        )}
      >
        <div className="max-h-64 overflow-y-auto">
          {views.length === 0 && <p className="px-2.5 py-2 text-[13.5px] text-subtle">Save the current view, filters and sort to come back to them in one click.</p>}
          {views.map((v) => (
            <div key={v.id} className="group flex items-center gap-1 rounded-lg hover:bg-hover">
              <button
                onClick={() => {
                  onApply(v.config);
                  toast.success(`Opened “${v.name}”`, { duration: 1500 });
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-2 text-left text-[14px]"
              >
                <Bookmark className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{v.name}</span>
                <span className="shrink-0 text-[12px] capitalize text-subtle">{v.config.view}</span>
                {v.shared && <Share2 className="h-3.5 w-3.5 shrink-0 text-subtle" aria-label="Shared" />}
              </button>
              {v.mine && (
                <button
                  aria-label={`Delete ${v.name}`}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteSavedViewAction(organizationId, v.id);
                      if (!r.ok) return void toast.error(r.message);
                      setViews((xs) => xs.filter((x) => x.id !== v.id));
                    })
                  }
                  className="mr-1 cursor-pointer rounded p-1 text-subtle opacity-0 hover:text-red-600 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        <form
          className="mt-1.5 space-y-2 border-t border-border px-1.5 pt-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            start(async () => {
              const config: SavedViewConfig = { view, filters: filters as unknown as Record<string, unknown>, sort, groupBy };
              const r = await saveViewAction(organizationId, projectId, { name: n, config, shared });
              if (!r.ok) return void toast.error(r.message);
              setViews((xs) => [...xs, r.view]);
              setName("");
              toast.success(`Saved “${n}”`);
            });
          }}
        >
          <div className="text-[13px] font-semibold text-subtle">Save current view</div>
          <div className="flex gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="e.g. My urgent bugs"
              aria-label="View name"
              className="h-8 min-w-0 flex-1 rounded-md border border-border px-2 text-[14px] outline-none focus:border-primary"
            />
            <button disabled={pending || !name.trim()} className="h-8 cursor-pointer rounded-md bg-primary px-2.5 text-[13px] font-medium text-white disabled:opacity-50">Save</button>
          </div>
          {canShare && (
            <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-muted">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="accent-[#7b68ee]" /> Share with everyone in this project
            </label>
          )}
        </form>
      </Popover>
    </div>
  );
}
