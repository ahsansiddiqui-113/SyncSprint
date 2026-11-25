import type { TaskPriority } from "@/db/schema";
import type { TaskDTO } from "@/lib/realtime-protocol";

export type Filters = {
  q: string;
  assignees: string[]; // user ids; "__none" = unassigned
  priorities: TaskPriority[];
  onlyMine: boolean;
  hideDone: boolean;
};

export const EMPTY_FILTERS: Filters = { q: "", assignees: [], priorities: [], onlyMine: false, hideDone: false };

export function activeFilterCount(f: Filters) {
  return (f.q.trim() ? 1 : 0) + f.assignees.length + f.priorities.length + (f.onlyMine ? 1 : 0) + (f.hideDone ? 1 : 0);
}

/**
 * Pure client-side filter shared by every view. Filtering never changes server
 * state; it only narrows what's rendered (drag positions still use real neighbours).
 */
export function applyFilters(
  tasks: Record<string, TaskDTO>,
  f: Filters,
  ctx: { meId: string; doneColumnId: string | null; refOf: (t: TaskDTO) => string }
): Record<string, TaskDTO> {
  if (activeFilterCount(f) === 0) return tasks;
  const q = f.q.trim().toLowerCase();
  const out: Record<string, TaskDTO> = {};
  for (const t of Object.values(tasks)) {
    if (q && !t.title.toLowerCase().includes(q) && !ctx.refOf(t).toLowerCase().includes(q) && !(t.description ?? "").toLowerCase().includes(q)) continue;
    if (f.onlyMine && t.assigneeId !== ctx.meId) continue;
    if (f.assignees.length && !f.assignees.includes(t.assigneeId ?? "__none")) continue;
    if (f.priorities.length && !f.priorities.includes(t.priority)) continue;
    if (f.hideDone && t.columnId === ctx.doneColumnId) continue;
    out[t.id] = t;
  }
  return out;
}
