"use client";

import { ChevronDown, EyeOff, Search, User, X } from "lucide-react";
import type { TaskPriority } from "@/db/schema";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { PRIORITY_STYLE, PriorityFlag } from "@/components/ui/badge";
import { CheckRow, Popover } from "@/components/ui/popover";
import { activeFilterCount, EMPTY_FILTERS, type Filters } from "./filters";
import type { Member } from "./kanban-board";
import type { TagInfo } from "./decor";

const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function Chip({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[14px] font-medium transition-colors",
        active ? "border-primary/40 bg-primary-soft text-primary" : "border-border bg-white text-muted hover:bg-hover hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

export function FilterBar({
  filters,
  onChange,
  members,
  tags,
  shown,
  total,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  members: Member[];
  tags: TagInfo[];
  shown: number;
  total: number;
}) {
  const count = activeFilterCount(filters);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-white px-8 py-2.5">
      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-subtle" />
        <input
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="h-9 w-64 rounded-lg border border-border bg-surface-2 pl-9 pr-3 text-[14px] outline-none transition-colors placeholder:text-subtle focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/15"
        />
      </label>

      <Chip active={filters.onlyMine} onClick={() => set({ onlyMine: !filters.onlyMine })}>
        <User className="h-4 w-4" /> Me
      </Chip>

      <Popover
        trigger={() => (
          <Chip active={filters.assignees.length > 0}>
            Assignee{filters.assignees.length ? ` · ${filters.assignees.length}` : ""} <ChevronDown className="h-3.5 w-3.5" />
          </Chip>
        )}
      >
        {members.map((m) => (
          <CheckRow key={m.id} checked={filters.assignees.includes(m.id)} onChange={() => set({ assignees: toggle(filters.assignees, m.id) })}>
            <Avatar id={m.id} name={m.name} src={m.avatarUrl} size={22} />
            <span className="truncate">{m.name}</span>
          </CheckRow>
        ))}
        <CheckRow checked={filters.assignees.includes("__none")} onChange={() => set({ assignees: toggle(filters.assignees, "__none") })}>
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-dashed border-border-strong" />
          Unassigned
        </CheckRow>
      </Popover>

      <Popover
        trigger={() => (
          <Chip active={filters.priorities.length > 0}>
            Priority{filters.priorities.length ? ` · ${filters.priorities.length}` : ""} <ChevronDown className="h-3.5 w-3.5" />
          </Chip>
        )}
      >
        {PRIORITIES.map((p) => (
          <CheckRow key={p} checked={filters.priorities.includes(p)} onChange={() => set({ priorities: toggle(filters.priorities, p) })}>
            <PriorityFlag priority={p} /> {PRIORITY_STYLE[p].label}
          </CheckRow>
        ))}
      </Popover>

      {tags.length > 0 && (
        <Popover
          trigger={() => (
            <Chip active={filters.tagIds.length > 0}>
              Tags{filters.tagIds.length ? ` · ${filters.tagIds.length}` : ""} <ChevronDown className="h-3.5 w-3.5" />
            </Chip>
          )}
        >
          {tags.map((t) => (
            <CheckRow key={t.id} checked={filters.tagIds.includes(t.id)} onChange={() => set({ tagIds: toggle(filters.tagIds, t.id) })}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
              <span className="truncate">{t.name}</span>
            </CheckRow>
          ))}
        </Popover>
      )}

      <Chip active={filters.hideDone} onClick={() => set({ hideDone: !filters.hideDone })}>
        <EyeOff className="h-4 w-4" /> Hide done
      </Chip>

      {count > 0 && (
        <>
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-[14px] font-medium text-primary hover:bg-primary-soft"
          >
            <X className="h-4 w-4" /> Clear
          </button>
          <span className="text-[14px] text-subtle">
            Showing {shown} of {total}
          </span>
        </>
      )}
    </div>
  );
}
