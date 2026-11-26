import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db";
import { boardColumns, sprints, taskAssignees, tasks } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { statusFor, workloadFor, type CapacityStatus } from "./capacity";

/**
 * Sprint capacity planning (Azure Boards "Capacity" tab): for each person, the hours
 * they have in the sprint (work schedule minus time off and holidays) against the
 * open estimated work assigned to them in this sprint. Advisory, like every capacity
 * signal in SyncSprint: over-committing is shown, never blocked.
 */

export type SprintCapacityPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  availableHours: number;
  committedHours: number;
  tasks: number;
  unestimated: number;
  status: CapacityStatus;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function sprintCapacity(conn: DB, actorId: string, organizationId: string, sprintId: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const [sprint] = await conn.select().from(sprints).where(and(eq(sprints.id, sprintId), eq(sprints.organizationId, organizationId))).limit(1);
  if (!sprint) throw new AppError("NOT_FOUND", "Sprint not found");
  if (!sprint.startDate || !sprint.endDate) throw new AppError("VALIDATION", "Give the sprint start and end dates to plan capacity");

  const [{ settings, people }, [done], items] = await Promise.all([
    workloadFor(conn, organizationId, { from: sprint.startDate, to: sprint.endDate }),
    conn.select({ id: boardColumns.id }).from(boardColumns).where(eq(boardColumns.projectId, sprint.projectId)).orderBy(desc(boardColumns.position)).limit(1),
    conn
      .select({ id: tasks.id, assigneeId: tasks.assigneeId, estimateHours: tasks.estimateHours, columnId: tasks.columnId })
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.sprintId, sprint.id))),
  ]);
  const open = items.filter((t) => t.columnId !== done?.id);
  const co = open.length
    ? await conn.select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId }).from(taskAssignees).where(inArray(taskAssignees.taskId, open.map((t) => t.id)))
    : [];

  const byUser = new Map<string, { committed: number; tasks: number; unestimated: number }>();
  let unassigned = 0;
  let unassignedHours = 0;
  for (const t of open) {
    const everyone = [...new Set([t.assigneeId, ...co.filter((c) => c.taskId === t.id).map((c) => c.userId)].filter((u): u is string => !!u))];
    if (!everyone.length) {
      unassigned++;
      unassignedHours += t.estimateHours ?? 0;
      continue;
    }
    for (const u of everyone) {
      const row = byUser.get(u) ?? { committed: 0, tasks: 0, unestimated: 0 };
      row.tasks++;
      if (t.estimateHours) row.committed += t.estimateHours / everyone.length;
      else row.unestimated++;
      byUser.set(u, row);
    }
  }

  const rows: SprintCapacityPerson[] = people
    .map((p) => {
      const c = byUser.get(p.userId) ?? { committed: 0, tasks: 0, unestimated: 0 };
      return {
        userId: p.userId,
        name: p.name,
        avatarUrl: p.avatarUrl,
        availableHours: p.totalCapacity,
        committedHours: r1(c.committed),
        tasks: c.tasks,
        unestimated: c.unestimated,
        status: statusFor(c.committed, p.totalCapacity, settings.nearThreshold),
      };
    })
    .filter((p) => p.availableHours > 0 || p.tasks > 0)
    .sort((a, b) => b.committedHours / (b.availableHours || 1) - a.committedHours / (a.availableHours || 1));

  const available = r1(rows.reduce((s, p) => s + p.availableHours, 0));
  const committed = r1(rows.reduce((s, p) => s + p.committedHours, 0) + unassignedHours);
  return {
    sprint: { id: sprint.id, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, status: sprint.status },
    people: rows,
    totals: { available, committed, unassigned, unassignedHours: r1(unassignedHours), status: statusFor(committed, available, settings.nearThreshold) },
    nearThreshold: settings.nearThreshold,
  };
}
