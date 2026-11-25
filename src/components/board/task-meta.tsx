import { Ban, Bookmark, Bug, CalendarDays, CornerDownRight, GitBranch, ListChecks, SquareCheck, Zap } from "lucide-react";
import type { WorkItemType } from "@/db/schema";
import { dueState, relativeDueLabel, type DueState } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TaskDecor } from "./decor";

const DUE_STYLE: Record<DueState, string> = {
  overdue: "border-red-200 bg-red-50 text-red-600",
  today: "border-orange-200 bg-orange-50 text-orange-600",
  soon: "border-amber-200 bg-amber-50 text-amber-700",
  later: "border-border bg-white text-muted",
};

/** Due date chip, colored by urgency (overdue / today / soon / later). */
export function DueChip({ due, done, className }: { due: string | null; done: boolean; className?: string }) {
  const state = dueState(due, done);
  if (!due || !state) return null;
  return (
    <span
      title={state === "overdue" ? "Overdue" : `Due ${due}`}
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12.5px] font-medium", DUE_STYLE[state], className)}
    >
      <CalendarDays className="h-3.5 w-3.5" />
      {relativeDueLabel(due)}
    </span>
  );
}

/** Story-point bubble (Azure Boards "effort"). */
export function PointsBadge({ points, className }: { points: number | null; className?: string }) {
  if (points === null || points === undefined) return null;
  return (
    <span
      title={`${points} story points`}
      className={cn("inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-surface-2 px-1.5 text-[12px] font-semibold text-muted", className)}
    >
      {points}
    </span>
  );
}

/* ------------------------------- Phase 2 ------------------------------- */

/** Tag chip: name always visible; color is a secondary cue (tinted fill + dot). */
export function TagChip({ name, color, onRemove, className }: { name: string; color: string; onRemove?: () => void; className?: string }) {
  return (
    <span
      className={cn("inline-flex max-w-40 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12.5px] font-medium text-foreground", className)}
      style={{ backgroundColor: `${color}1f` }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove tag ${name}`}
          className="-mr-0.5 cursor-pointer rounded px-0.5 text-subtle hover:bg-black/10 hover:text-foreground"
        >
          ×
        </button>
      )}
    </span>
  );
}

function Progress({ icon: Icon, done, total, label }: { icon: typeof ListChecks; done: number; total: number; label: string }) {
  const complete = total > 0 && done === total;
  return (
    <span
      title={`${label}: ${done} of ${total} done`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] font-medium",
        complete ? "bg-emerald-50 text-emerald-700" : "bg-surface-2 text-muted"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {done}/{total}
    </span>
  );
}

/** Secondary row of Phase 2 indicators shared by cards and list rows. */
export function BreakdownBadges({ taskId, decor, maxTags = 3, className }: { taskId: string; decor: TaskDecor; maxTags?: number; className?: string }) {
  const tagIds = decor.tagsByTask[taskId] ?? [];
  const tags = tagIds.map((id) => decor.tagsById.get(id)).filter(Boolean) as { id: string; name: string; color: string }[];
  const check = decor.checklist[taskId];
  const subs = decor.subtasks.get(taskId);
  const blockers = decor.openBlockers.get(taskId)?.length ?? 0;
  if (!tags.length && !check && !subs && !blockers) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {blockers > 0 && (
        <span
          title={`Blocked by ${blockers} unfinished task${blockers === 1 ? "" : "s"}`}
          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[12.5px] font-semibold text-red-600"
        >
          <Ban className="h-3.5 w-3.5" /> Blocked
        </span>
      )}
      {subs && <Progress icon={GitBranch} done={subs.done} total={subs.total} label="Subtasks" />}
      {check && <Progress icon={ListChecks} done={check.done} total={check.total} label="Checklist" />}
      {tags.slice(0, maxTags).map((t) => (
        <TagChip key={t.id} name={t.name} color={t.color} />
      ))}
      {tags.length > maxTags && <span className="text-[12.5px] text-subtle">+{tags.length - maxTags}</span>}
    </div>
  );
}

/** "↳ ENG-1 Parent title" link shown on subtasks. */
export function ParentRef({ parent, refLabel, className }: { parent: { title: string } | undefined; refLabel: string; className?: string }) {
  if (!parent) return null;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 text-[12.5px] text-subtle", className)} title={`Subtask of ${refLabel} ${parent.title}`}>
      <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
      <span className="shrink-0 font-medium">{refLabel}</span>
      <span className="truncate">{parent.title}</span>
    </span>
  );
}

/* ------------------------------- Phase 3 ------------------------------- */

export const TYPE_META: Record<WorkItemType, { label: string; icon: typeof Zap; color: string }> = {
  epic: { label: "Epic", icon: Zap, color: "#8a5cf6" },
  story: { label: "Story", icon: Bookmark, color: "#0f9d74" },
  task: { label: "Task", icon: SquareCheck, color: "#3f7cb8" },
  bug: { label: "Bug", icon: Bug, color: "#dc2626" },
};
export const WORK_ITEM_TYPES: WorkItemType[] = ["epic", "story", "task", "bug"];

/** Work item type glyph: a filled tile with a distinct icon per type (+ title for screen readers). */
export function TypeIcon({ type, size = 18, className }: { type: WorkItemType; size?: number; className?: string }) {
  const m = TYPE_META[type];
  return (
    <span
      title={m.label}
      aria-label={m.label}
      role="img"
      className={cn("inline-flex shrink-0 items-center justify-center rounded text-white", className)}
      style={{ width: size, height: size, backgroundColor: m.color }}
    >
      <m.icon style={{ width: size * 0.65, height: size * 0.65 }} strokeWidth={2.5} />
    </span>
  );
}
