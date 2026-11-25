import type { TaskDTO } from "@/lib/realtime-protocol";
import type { ProjectMeta } from "@/server/services/breakdown";

export type TagInfo = { id: string; name: string; color: string };

/**
 * Derived, read-only decoration for task cards and rows, computed from the
 * task map (subtasks, blockers) and the server's project meta (checklists, tags, deps).
 */
export type TaskDecor = {
  tags: TagInfo[];
  tagsById: Map<string, TagInfo>;
  tagsByTask: Record<string, string[]>;
  checklist: Record<string, { done: number; total: number }>;
  subtasks: Map<string, { done: number; total: number }>;
  /** Unfinished blockers per blocked task id. */
  openBlockers: Map<string, string[]>;
  deps: ProjectMeta["deps"];
};

export const EMPTY_META: ProjectMeta = { checklist: {}, tagsByTask: {}, tags: [], deps: [], fields: [], fieldValues: {}, coAssignees: {}, watchers: {} };

export function buildDecor(tasks: Record<string, TaskDTO>, meta: ProjectMeta, doneColumnId: string | null): TaskDecor {
  const subtasks = new Map<string, { done: number; total: number }>();
  for (const t of Object.values(tasks)) {
    if (!t.parentId) continue;
    const s = subtasks.get(t.parentId) ?? { done: 0, total: 0 };
    s.total++;
    if (t.columnId === doneColumnId) s.done++;
    subtasks.set(t.parentId, s);
  }

  const openBlockers = new Map<string, string[]>();
  for (const d of meta.deps) {
    const blocker = tasks[d.blockerId];
    if (!blocker || blocker.columnId === doneColumnId) continue; // finished blockers no longer block
    openBlockers.set(d.blockedId, [...(openBlockers.get(d.blockedId) ?? []), d.blockerId]);
  }

  return {
    tags: meta.tags,
    tagsById: new Map(meta.tags.map((t) => [t.id, t])),
    tagsByTask: meta.tagsByTask,
    checklist: meta.checklist,
    subtasks,
    openBlockers,
    deps: meta.deps,
  };
}
