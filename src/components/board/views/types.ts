import type { PresenceUser, TaskDTO } from "@/lib/realtime-protocol";
import type { Column, Member } from "../kanban-board";
import type { TaskDecor } from "../decor";

export type TaskPatch = Partial<Pick<TaskDTO, "title" | "description" | "priority" | "assigneeId" | "startDate" | "dueDate" | "storyPoints" | "estimateHours" | "type" | "sprintId">>;

/** Props every project view receives. `tasks` is already filtered by the filter bar. */
export type ViewProps = {
  tasks: Record<string, TaskDTO>;
  columns: Column[];
  colorOf: (columnIndex: number) => string;
  doneColumnId: string | null;
  refOf: (t: { taskNumber: number }) => string;
  memberById: Map<string, Member>;
  presenceByTask: Map<string, PresenceUser[]>;
  flash: Record<string, true>;
  canEdit: boolean;
  onOpen: (taskId: string) => void;
  onAdd: (opts?: { columnId?: string; dueDate?: string }) => void;
  /** Tags, checklist / subtask progress and blockers for every task (unfiltered). */
  decor: TaskDecor;
  /** All tasks in the project, unfiltered (for parent lookups). */
  allTasks: Record<string, TaskDTO>;
};

export const VIEWS = ["board", "list", "table", "sprints", "calendar", "timeline", "workload", "dashboard"] as const;
export type ViewId = (typeof VIEWS)[number];
