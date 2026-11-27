import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, projects, sprints, users, type ProjectStatus } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { resolveToday } from "./capacity";

/**
 * Portfolio: every project in the workspace on one page (Asana Portfolios / Jira Plans).
 * Health is computed from the data so it can't go stale:
 *  - done:        every task is finished
 *  - late:        the latest due date has passed with work still open
 *  - at_risk:     overdue tasks, or progress more than 20 points behind the time elapsed
 *  - on_track:    otherwise; "not_started" when there's nothing scheduled yet
 * Admins can also post a status update (on track / at risk / off track / on hold / complete + a note).
 */

export type Health = "on_track" | "at_risk" | "late" | "done" | "not_started";

const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Pure: health from counts and the project's date span. */
export function projectHealth(p: { total: number; done: number; overdue: number; start: string | null; end: string | null }, today: string): { health: Health; expected: number | null } {
  if (p.total === 0) return { health: "not_started", expected: null };
  if (p.done === p.total) return { health: "done", expected: 1 };
  if (p.end && p.end < today) return { health: "late", expected: 1 };
  let expected: number | null = null;
  if (p.start && p.end && utc(p.end) > utc(p.start)) {
    expected = Math.min(1, Math.max(0, (utc(today) - utc(p.start)) / (utc(p.end) - utc(p.start))));
  }
  const progress = p.done / p.total;
  if (p.overdue > 0 || (expected !== null && expected - progress > 0.2)) return { health: "at_risk", expected };
  if (!p.start && !p.end) return { health: "not_started", expected };
  return { health: "on_track", expected };
}

export async function getPortfolio(conn: DB, actorId: string, organizationId: string, clientToday?: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const today = resolveToday(clientToday);
  const projRows = await conn
    .select({ p: projects, updatedByName: users.name })
    .from(projects)
    .leftJoin(users, eq(users.id, projects.statusUpdatedById))
    .where(eq(projects.organizationId, organizationId))
    .orderBy(asc(projects.key));

  // Per project: totals, done (in its last status), overdue, points, date span.
  const stats = await conn.execute(sql`
    with last_col as (
      select distinct on (project_id) project_id, id
      from board_columns where organization_id = ${organizationId}
      order by project_id, position desc
    )
    select t.project_id as "projectId",
      count(*)::int as total,
      count(*) filter (where t.column_id = lc.id)::int as done,
      count(*) filter (where t.column_id <> lc.id and t.due_date < ${today})::int as overdue,
      coalesce(sum(t.story_points), 0)::int as points,
      coalesce(sum(t.story_points) filter (where t.column_id = lc.id), 0)::int as "pointsDone",
      min(coalesce(t.start_date, t.due_date))::text as start,
      max(coalesce(t.due_date, t.start_date))::text as "end"
    from tasks t join last_col lc on lc.project_id = t.project_id
    where t.organization_id = ${organizationId}
    group by t.project_id`);
  const rows = ((stats as unknown as { rows?: unknown[] }).rows ?? (stats as unknown as unknown[])) as {
    projectId: string; total: number; done: number; overdue: number; points: number; pointsDone: number; start: string | null; end: string | null;
  }[];
  const active = await conn
    .select({ projectId: sprints.projectId, id: sprints.id, name: sprints.name, endDate: sprints.endDate })
    .from(sprints)
    .where(and(eq(sprints.organizationId, organizationId), eq(sprints.status, "active")));

  return {
    today,
    projects: projRows.map(({ p, updatedByName }) => {
      const s = rows.find((r) => r.projectId === p.id) ?? { total: 0, done: 0, overdue: 0, points: 0, pointsDone: 0, start: null, end: null };
      const { health, expected } = projectHealth(s, today);
      const sprint = active.find((a) => a.projectId === p.id);
      return {
        id: p.id, key: p.key, name: p.name, description: p.description,
        total: s.total, done: s.done, open: s.total - s.done, overdue: s.overdue, points: s.points, pointsDone: s.pointsDone,
        start: s.start, end: s.end, progress: s.total ? s.done / s.total : 0, expected, health,
        sprint: sprint ? { id: sprint.id, name: sprint.name, endDate: sprint.endDate } : null,
        status: p.status ? { value: p.status, note: p.statusNote, at: p.statusUpdatedAt?.toISOString() ?? null, by: updatedByName } : null,
      };
    }),
  };
}

export async function setProjectStatus(conn: DB, actorId: string, organizationId: string, projectId: string, raw: { status: ProjectStatus; note?: string | null }) {
  const input = z.object({ status: z.enum(["on_track", "at_risk", "off_track", "on_hold", "complete"]), note: z.string().trim().max(500).nullish() }).parse(raw);
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const [p] = await conn
    .update(projects)
    .set({ status: input.status, statusNote: input.note || null, statusUpdatedAt: new Date(), statusUpdatedById: actorId })
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .returning({ name: projects.name });
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "PROJECT_STATUS_UPDATED", entityType: "project", entityId: projectId, metadata: { status: input.status, note: input.note ?? null } });
}

