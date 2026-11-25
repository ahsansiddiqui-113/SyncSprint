import { CalendarDays } from "lucide-react";
import { dueState, relativeDueLabel, type DueState } from "@/lib/dates";
import { cn } from "@/lib/utils";

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
