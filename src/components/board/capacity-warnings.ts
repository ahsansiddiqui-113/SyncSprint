import { toast } from "sonner";
import type { CapacityWarning } from "@/server/services/capacity";
import { formatShort, formatWeekday } from "@/lib/dates";

const h = (n: number) => `${Math.round(n * 10) / 10}h`;

export function describeWarning(w: CapacityWarning): { title: string; detail: string } {
  if (w.level === "over") {
    const first = w.overDays[0]!;
    const more = w.overDays.length > 1 ? ` and ${w.overDays.length - 1} more day${w.overDays.length > 2 ? "s" : ""}` : "";
    const where = first.capacity === 0 ? `on ${formatWeekday(first.day)}, ${formatShort(first.day)} (a day off)` : `on ${formatWeekday(first.day)}, ${formatShort(first.day)}`;
    return {
      title: `${w.name} will be over capacity`,
      detail: `${h(first.load)} of ${h(first.capacity)} ${where}${first.capacity > 0 ? ` (+${h(first.load - first.capacity)})` : ""}${more} · this week ${h(w.weekLoad)} of ${h(w.weekCapacity)}`,
    };
  }
  return { title: `${w.name} is near capacity`, detail: `${h(w.weekLoad)} of ${h(w.weekCapacity)} this week` };
}

/**
 * Show advisory capacity warnings. The change is already saved: this never blocks,
 * it only makes the overload visible (like Azure Boards' red capacity bars).
 */
export function showCapacityWarnings(warnings: CapacityWarning[] | undefined, onView?: () => void) {
  for (const w of warnings ?? []) {
    const { title, detail } = describeWarning(w);
    const opts = {
      description: `${detail}. The assignment was saved — consider rebalancing.`,
      duration: 9000,
      ...(onView ? { action: { label: "View workload", onClick: onView } } : {}),
    };
    if (w.level === "over") toast.warning(title, opts);
    else toast.info(title, opts);
  }
}
