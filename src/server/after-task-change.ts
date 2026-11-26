import "server-only";
import { toTaskDTO, type Actor } from "@/lib/realtime-protocol";
import type { Task } from "@/db/schema";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { pingInboxes } from "@/server/inbox-broadcast";
import { publishTask } from "@/server/public-events";
import type { Effects } from "@/server/services/task-effects";

/**
 * Publish everything a committed task change produced besides the task itself:
 * recurring occurrences, automation comments/tags, inbox pings and webhooks.
 */
export function publishEffects(organizationId: string, actor: Actor, projectId: string, fx: Effects) {
  for (const t of fx.created) {
    broadcastOrgEvent(organizationId, { type: "TASK_CREATED", actor, task: toTaskDTO(t) });
    publishTask(organizationId, "task.created", t, { recurring: true });
  }
  for (const taskId of fx.commented) broadcastOrgEvent(organizationId, { type: "COMMENT_ADDED", actor, taskId, commentId: "" });
  if (fx.tagged.size) broadcastOrgEvent(organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [...fx.tagged], kind: "tags" });
  pingInboxes(organizationId, [...fx.notified]);
}

export function publishTaskUpdate(organizationId: string, task: Task, changes: string[]) {
  publishTask(organizationId, "task.updated", task, { changes });
}
