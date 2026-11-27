import { db, type DB } from "@/db";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { acquireLease, releaseLease, runScheduledAutomations } from "@/server/services/scheduler";
import { purgeAuditLogs } from "@/server/services/security";
import { deliverDueReminders } from "@/server/services/reminders";
import { fanOutNotifications, sendDigests } from "@/server/services/outbound";

/**
 * Runs scheduled automations once, under a database lease so only one server
 * instance works at a time, then publishes the changes live.
 * Triggered by: server.ts every minute (long-running servers), /api/cron/automations
 * (Vercel Cron or any external pinger), and kickScheduler() from active users' polling.
 * No "server-only" import: server.ts loads this outside Next.js.
 */
const LEASE = "automations";
const SYSTEM = { id: "system", name: "Automation" };

export async function runScheduler(conn: DB = db) {
  if (!(await acquireLease(conn, LEASE, 5 * 60_000))) return { skipped: true as const };
  try {
    const r = await runScheduledAutomations(conn);
    for (const c of r.changes) {
      broadcastOrgEvent(c.organizationId, { type: "TASK_UPDATED", actor: SYSTEM, task: toTaskDTO(c.task), action: "edited", changes: ["automation"] });
      if (c.commented) broadcastOrgEvent(c.organizationId, { type: "COMMENT_ADDED", actor: SYSTEM, taskId: c.task.id, commentId: "" });
      if (c.tagged) broadcastOrgEvent(c.organizationId, { type: "TASK_META_CHANGED", actor: SYSTEM, projectId: c.task.projectId, taskIds: [c.task.id], kind: "tags" });
      if (c.notified.length) broadcastOrgEvent(c.organizationId, { type: "NOTIFICATIONS_CHANGED", userIds: c.notified });
    }
    // Personal reminders that are due (every run).
    try {
      for (const r of await deliverDueReminders(conn)) broadcastOrgEvent(r.organizationId, { type: "NOTIFICATIONS_CHANGED", userIds: r.userIds });
    } catch (err) {
      console.error("[scheduler] reminders failed", err);
    }
    // New in-app notifications go out by email / push / WhatsApp per each person's preferences.
    try {
      await fanOutNotifications(conn);
    } catch (err) {
      console.error("[scheduler] notification fan-out failed", err);
    }
    await runPeriodicJobs(conn);
    return { skipped: false as const, rules: r.rules, fired: r.fired };
  } finally {
    await releaseLease(conn, LEASE);
  }
}

/**
 * Housekeeping that needs to run every so often, not every minute. Each job holds its own
 * lease for its whole interval (never released early), so it runs at most once per interval
 * across every server instance. A failing job never stops the others.
 */
async function periodic(conn: DB, name: string, everyMs: number, run: () => Promise<unknown>) {
  if (!(await acquireLease(conn, `job:${name}`, everyMs))) return;
  try {
    await run();
  } catch (err) {
    console.error(`[scheduler] job ${name} failed`, err);
  }
}

async function runPeriodicJobs(conn: DB) {
  await periodic(conn, "audit-purge", 6 * 3_600_000, () => purgeAuditLogs(conn));
  await periodic(conn, "digests", 3_600_000, () => sendDigests(conn));
}

const g = globalThis as { __ssSchedulerKick?: number };

/** Cheap nudge from user traffic (e.g. Vercel polling): at most once a minute per instance. */
export function kickScheduler() {
  const now = Date.now();
  if (g.__ssSchedulerKick && now - g.__ssSchedulerKick < 60_000) return;
  g.__ssSchedulerKick = now;
  void runScheduler().catch((err) => console.error("[scheduler] run failed", err));
}
