import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import * as s from "@/db/schema";

import { requireOrgPermission } from "@/lib/rbac";

/* ---------------------------------- onboarding ---------------------------------- */

export type OnboardingStep = { id: string; title: string; text: string; done: boolean; href: string };

/** The getting-started checklist on the workspace home (admins). Worked out from data, never stale. */
export async function getOnboarding(conn: DB, actorId: string, organizationId: string, slug: string) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const [o] = await conn.select().from(s.organizations).where(eq(s.organizations.id, organizationId)).limit(1);
  if (!o || o.isDemo || o.onboardingDismissedAt) return null;
  const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const c = sql<number>`count(*)::int`;
  const [projects, taskCount, members, invites, automations, chats, repos, keys, hooks, me] = await Promise.all([
    n(conn.select({ n: c }).from(s.projects).where(eq(s.projects.organizationId, organizationId))),
    n(conn.select({ n: c }).from(s.tasks).where(eq(s.tasks.organizationId, organizationId))),
    n(conn.select({ n: c }).from(s.orgMembers).where(eq(s.orgMembers.organizationId, organizationId))),
    n(conn.select({ n: c }).from(s.orgInvites).where(eq(s.orgInvites.organizationId, organizationId))),
    n(conn.select({ n: c }).from(s.automations).where(eq(s.automations.organizationId, organizationId))),
    n(conn.select({ n: c }).from(s.chatChannels).where(eq(s.chatChannels.organizationId, organizationId))),
    n(conn.select({ n: c }).from(s.repoConnections).where(eq(s.repoConnections.organizationId, organizationId))),
    n(conn.select({ n: c }).from(s.apiKeys).where(eq(s.apiKeys.organizationId, organizationId))),
    n(conn.select({ n: c }).from(s.webhooks).where(eq(s.webhooks.organizationId, organizationId))),
    conn.select({ on: s.users.twoFactorEnabled }).from(s.users).where(eq(s.users.id, actorId)).limit(1),
  ]);
  const base = `/w/${slug}`;
  const steps: OnboardingStep[] = [
    { id: "project", title: "Create a project", text: "Start from a template: Scrum, bug tracking, marketing, onboarding or a roadmap.", done: projects > 0, href: `${base}#new-project` },
    { id: "task", title: "Add your first tasks", text: "Or import them from Jira or a CSV file.", done: taskCount > 0, href: base },
    { id: "invite", title: "Invite your team", text: "Members do the work; viewers and guests are free.", done: members > 1 || invites > 0, href: `${base}/settings/members` },
    { id: "automate", title: "Automate a routine", text: "\"When a bug is urgent, move it to In Progress and tell the lead.\"", done: automations > 0, href: base },
    { id: "connect", title: "Connect your tools", text: "Slack or Teams alerts, GitHub links, email-to-task, the API.", done: chats + repos + keys + hooks > 0, href: `${base}/settings/integrations` },
    { id: "secure", title: "Turn on two-step sign-in", text: "Protect your account with an authenticator app.", done: !!me[0]?.on, href: "/account/security" },
    { id: "plan", title: "Choose a plan", text: "Keep everything after the free trial.", done: o.plan !== "trial", href: `${base}/settings/billing` },
  ];
  const done = steps.filter((x) => x.done).length;
  return { steps, done, total: steps.length };
}

export async function dismissOnboarding(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  await conn.update(s.organizations).set({ onboardingDismissedAt: new Date() }).where(eq(s.organizations.id, organizationId));
}

/* ------------------------------------ search ------------------------------------ */

const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** Everything Ctrl/Cmd+K can jump to: tasks (by title or ref like ENG-12), projects, docs, goals, people. */
export async function searchWorkspace(conn: DB, actorId: string, organizationId: string, raw: string) {
  const q = z.string().trim().max(100).parse(raw);
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  if (!q) return { tasks: [], projects: [], docs: [], goals: [], people: [] };
  const ref = q.match(/^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})$/);
  const pat = like(q);
  const taskSel = { id: s.tasks.id, title: s.tasks.title, number: s.tasks.taskNumber, key: s.projects.key, project: s.projects.name, status: s.boardColumns.title, type: s.tasks.type };
  const [refHits, titleHits, projects, docs, goals, people] = await Promise.all([
    ref
      ? conn.select(taskSel).from(s.tasks).innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId)).innerJoin(s.boardColumns, eq(s.boardColumns.id, s.tasks.columnId))
          .where(and(eq(s.tasks.organizationId, organizationId), eq(s.projects.key, ref[1]!.toUpperCase()), eq(s.tasks.taskNumber, Number(ref[2])))).limit(1)
      : Promise.resolve([]),
    conn.select(taskSel).from(s.tasks).innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId)).innerJoin(s.boardColumns, eq(s.boardColumns.id, s.tasks.columnId))
      .where(and(eq(s.tasks.organizationId, organizationId), ilike(s.tasks.title, pat))).orderBy(sql`${s.tasks.createdAt} desc`).limit(8),
    conn.select({ id: s.projects.id, key: s.projects.key, name: s.projects.name }).from(s.projects)
      .where(and(eq(s.projects.organizationId, organizationId), or(ilike(s.projects.name, pat), ilike(s.projects.key, pat)))).orderBy(asc(s.projects.key)).limit(5),
    conn.select({ id: s.docs.id, title: s.docs.title }).from(s.docs).where(and(eq(s.docs.organizationId, organizationId), ilike(s.docs.title, pat))).limit(5),
    conn.select({ id: s.goals.id, title: s.goals.title }).from(s.goals).where(and(eq(s.goals.organizationId, organizationId), ilike(s.goals.title, pat))).limit(3),
    conn.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.orgMembers).innerJoin(s.users, eq(s.users.id, s.orgMembers.userId))
      .where(and(eq(s.orgMembers.organizationId, organizationId), or(ilike(s.users.name, pat), ilike(s.users.email, pat)))).limit(5),
  ]);
  const seen = new Set(refHits.map((t) => t.id));
  const tasks = [...refHits, ...titleHits.filter((t) => !seen.has(t.id))].slice(0, 8).map((t) => ({ ...t, ref: `${t.key}-${t.number}` }));
  return { tasks, projects, docs, goals, people };
}

