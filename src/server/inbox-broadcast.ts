import "server-only";
import { db } from "@/db";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import type { CapacityWarning } from "@/server/services/capacity";
import { alertManagersOverCapacity, taskContext } from "@/server/services/notifications";

/** Tell recipients' clients to refetch their inbox (contents stay on the server). */
export function pingInboxes(organizationId: string, userIds: string[]) {
  if (userIds.length) broadcastOrgEvent(organizationId, { type: "NOTIFICATIONS_CHANGED", userIds: [...new Set(userIds)] });
}

/** Over-capacity assignments also alert owners/admins (deduped per person per day). Never throws. */
export async function alertManagers(organizationId: string, actorId: string, taskId: string, warnings: CapacityWarning[]) {
  const over = warnings.flatMap((w) => (w.level === "over" ? w.overDays.slice(0, 1).map((d) => ({ userId: w.userId, name: w.name, ...d })) : []));
  if (!over.length) return;
  try {
    const ctx = await taskContext(db, organizationId, taskId);
    pingInboxes(organizationId, await alertManagersOverCapacity(db, organizationId, actorId, over, ctx?.link ?? null));
  } catch (err) {
    console.error("[capacity] manager alert failed", err);
  }
}
