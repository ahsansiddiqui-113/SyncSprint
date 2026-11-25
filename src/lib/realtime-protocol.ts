import type { OrgRole, Task, TaskPriority } from "@/db/schema";

/** JSON-safe task shape shared by RSC payloads, server actions and WebSocket events. */
export type TaskDTO = {
  id: string;
  organizationId: string;
  projectId: string;
  columnId: string;
  taskNumber: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  assigneeId: string | null;
  position: number;
  version: number;
  startDate: string | null;
  dueDate: string | null;
  storyPoints: number | null;
  parentId: string | null;
  updatedAt: string;
  createdAt: string;
};

export function toTaskDTO(t: Task): TaskDTO {
  return {
    ...t,
    updatedAt: new Date(t.updatedAt).toISOString(),
    createdAt: new Date(t.createdAt).toISOString(),
  };
}

export type PresenceUser = {
  connectionId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  projectId: string | null;
  activeTaskId: string | null;
  editing: boolean;
};

export type Actor = { id: string; name: string };

/** Server → client events, broadcast to room `org:{organizationId}`. */
export type OrgEvent =
  | { type: "TASK_CREATED"; actor: Actor; task: TaskDTO }
  | { type: "TASK_UPDATED"; actor: Actor; task: TaskDTO; action: "moved" | "edited"; changes?: string[] }
  | { type: "TASK_DELETED"; actor: Actor; taskId: string; projectId: string }
  | { type: "COLUMN_REBALANCED"; columnId: string; positions: Record<string, number> }
  | { type: "COMMENT_ADDED"; actor: Actor; taskId: string; commentId: string }
  /** Checklist / tag / dependency changes: clients refetch the project's meta. */
  | { type: "TASK_META_CHANGED"; actor: Actor; projectId: string; taskIds: string[]; kind: "checklist" | "tags" | "dependencies" }
  | { type: "MEMBERSHIP_CHANGED"; actor: Actor; userId: string; role: OrgRole | null };

export type ServerMessage =
  | { type: "WELCOME"; connectionId: string; userId: string }
  | { type: "PRESENCE"; users: PresenceUser[] }
  | { type: "EVENT"; event: OrgEvent }
  | { type: "ERROR"; code: string };

/** Client → server messages (ephemeral; never written to Postgres). */
export type ClientMessage = {
  type: "PRESENCE";
  projectId: string | null;
  activeTaskId: string | null;
  editing: boolean;
};

export const roomFor = (organizationId: string) => `org:${organizationId}`;
