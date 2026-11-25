import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { aiUsage, auditLogs, boardColumns, projects, tasks, users, type TaskPriority } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { generateStructured, wrapUntrusted } from "@/lib/ai-router";
import { requireOrgPermission } from "@/lib/rbac";
import { createTask } from "@/server/services/tasks";

const priorityEnum = z.enum(["low", "medium", "high", "urgent"]);

/* --------------------------------- quota --------------------------------- */

/** Atomic per-org/day counter (UPSERT … RETURNING) so one visitor can't drain shared free quotas. */
export async function consumeAiQuota(conn: DB, organizationId: string, limit = Number(process.env.AI_DAILY_ORG_QUOTA ?? 50)) {
  const day = new Date().toISOString().slice(0, 10);
  const [row] = await conn
    .insert(aiUsage)
    .values({ organizationId, day, count: 1 })
    .onConflictDoUpdate({ target: [aiUsage.organizationId, aiUsage.day], set: { count: sql`${aiUsage.count} + 1` } })
    .returning({ count: aiUsage.count });
  return (row?.count ?? 0) <= limit;
}

async function loadTask(conn: DB, organizationId: string, taskId: string) {
  const [row] = await conn
    .select({ task: tasks, key: projects.key })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Task not found");
  return row;
}

/* --------------------------- 1. subtask decomposer --------------------------- */

export const subtaskSchema = z.object({
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1).max(140),
        priority: priorityEnum,
        estimatedPoints: z.number().int().min(1).max(13),
      })
    )
    .min(1)
    .max(6),
});
export type Subtask = z.infer<typeof subtaskSchema>["subtasks"][number];

export function fallbackSubtasks(title: string): Subtask[] {
  const t = title.slice(0, 100);
  return [
    { title: `Define acceptance criteria: ${t}`, priority: "medium", estimatedPoints: 2 },
    { title: `Implement core logic + tests: ${t}`, priority: "high", estimatedPoints: 5 },
    { title: `Review, QA and deploy: ${t}`, priority: "medium", estimatedPoints: 2 },
  ];
}

export async function decomposeTask(conn: DB, actorId: string, organizationId: string, taskId: string) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const { task } = await loadTask(conn, organizationId, taskId);

  return generateStructured({
    schema: subtaskSchema,
    instructions:
      "You are a concise engineering project assistant. Break the task into 3 to 6 concrete, independently shippable subtasks. Use Fibonacci story points (1,2,3,5,8,13).",
    prompt: `Decompose this task:\n${wrapUntrusted({ Title: task.title, Description: task.description, Priority: task.priority })}`,
    fallback: () => ({ subtasks: fallbackSubtasks(task.title) }),
    allow: () => consumeAiQuota(conn, organizationId),
  });
}

export async function createSubtasks(
  conn: DB,
  actorId: string,
  organizationId: string,
  parentTaskId: string,
  subtasks: Subtask[]
) {
  const list = subtaskSchema.shape.subtasks.parse(subtasks);
  const { task: parent, key } = await loadTask(conn, organizationId, parentTaskId);
  const created = [];
  // Subtasks land in the first column (Backlog) of the parent's board.
  const [backlog] = await conn
    .select({ id: boardColumns.id })
    .from(boardColumns)
    .where(and(eq(boardColumns.organizationId, organizationId), eq(boardColumns.projectId, parent.projectId)))
    .orderBy(asc(boardColumns.position))
    .limit(1);
  for (const s of list) {
    created.push(
      await createTask(conn, actorId, {
        organizationId,
        columnId: backlog!.id,
        title: s.title,
        priority: s.priority,
        description: `Subtask of ${key}-${parent.taskNumber}`,
        storyPoints: s.estimatedPoints,
      })
    );
  }
  await conn.insert(auditLogs).values({
    organizationId,
    actorId,
    action: "AI_SUBTASKS_ADDED",
    entityType: "task",
    entityId: parent.id,
    metadata: { count: created.length, ids: created.map((c) => c.id) },
  });
  return created;
}

/* ------------------------------ 2. sprint digest ----------------------------- */

export const digestSchema = z.object({
  headline: z.string().max(200),
  completed: z.array(z.string().max(200)).max(10),
  inProgress: z.array(z.string().max(200)).max(10),
  blockersAndRisks: z.array(z.string().max(200)).max(10),
  suggestedFocus: z.array(z.string().max(200)).max(5),
});
export type Digest = z.infer<typeof digestSchema>;

export async function sprintDigest(conn: DB, actorId: string, organizationId: string, projectId: string, hours = 72) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const since = new Date(Date.now() - hours * 3600_000);

  // Tenant scope is applied *before* any context reaches a prompt.
  const [project] = await conn
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1);
  if (!project) throw new AppError("NOT_FOUND", "Project not found");

  const board = await conn
    .select({
      ref: tasks.taskNumber,
      title: tasks.title,
      priority: tasks.priority,
      column: boardColumns.title,
      columnPos: boardColumns.position,
      assignee: users.name,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .where(and(eq(tasks.organizationId, organizationId), eq(tasks.projectId, projectId)))
    .orderBy(asc(boardColumns.position), asc(tasks.position));

  const activity = await conn
    .select({ action: auditLogs.action, actor: users.name, entityId: auditLogs.entityId, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(eq(auditLogs.organizationId, organizationId), gte(auditLogs.createdAt, since)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(60);

  const lastCol = board.reduce((m, t) => Math.max(m, t.columnPos), 0);
  const label = (t: (typeof board)[number]) => `${project.key}-${t.ref} ${t.title}${t.assignee ? ` (${t.assignee})` : ""}`;
  const done = board.filter((t) => t.columnPos === lastCol);
  const open = board.filter((t) => t.columnPos !== lastCol);
  const active = open.filter((t) => t.columnPos !== board[0]?.columnPos);
  const hot = open.filter((t) => t.priority === "urgent" || t.priority === "high");
  const stale = open.filter((t) => t.updatedAt < new Date(Date.now() - 3 * 24 * 3600_000));

  const fallback = (): Digest => ({
    headline: `${project.name}: ${done.length} done, ${active.length} in flight, ${hot.length} high-priority open`,
    completed: done.slice(0, 8).map(label),
    inProgress: active.slice(0, 8).map((t) => `${label(t)} — ${t.column}`),
    blockersAndRisks: [
      ...hot.filter((t) => t.priority === "urgent").map((t) => `URGENT still open: ${label(t)}`),
      ...stale.slice(0, 3).map((t) => `No movement in 3+ days: ${label(t)}`),
    ].slice(0, 8),
    suggestedFocus: hot.slice(0, 3).map(label),
  });

  const boardText = board.map((t) => `- [${t.column}] ${project.key}-${t.ref} | ${t.priority} | ${t.assignee ?? "unassigned"} | ${t.title}`).join("\n");
  const activityText = activity.map((a) => `- ${a.createdAt.toISOString()} ${a.actor ?? "someone"} ${a.action}`).join("\n");

  const result = await generateStructured({
    schema: digestSchema,
    instructions:
      "You write crisp daily standup digests for engineering teams. Be factual, reference task keys like ENG-12, never invent tasks that are not in the data.",
    prompt: `Project "${project.name}" (window: last ${hours}h).\n${wrapUntrusted({ Board: `\n${boardText}`, Activity: `\n${activityText}` })}`,
    fallback,
    allow: () => consumeAiQuota(conn, organizationId),
  });
  return { ...result, stats: { done: done.length, inFlight: active.length, highPriority: hot.length, events: activity.length } };
}

/* -------------------------------- 3. triage -------------------------------- */

const URGENT_WORDS = /\b(outage|down|breach|security|leak|data loss|p0|sev ?1|prod(uction)? (bug|issue)|crash)\b/i;
const HIGH_WORDS = /\b(bug|fix|broken|regression|fail(ing|ure)?|error|customer|blocker|slow|latency)\b/i;
const LOW_WORDS = /\b(docs?|typo|cleanup|refactor|nice to have|polish|copy)\b/i;

export function heuristicPriority(text: string): TaskPriority {
  if (URGENT_WORDS.test(text)) return "urgent";
  if (HIGH_WORDS.test(text)) return "high";
  if (LOW_WORDS.test(text)) return "low";
  return "medium";
}

export async function triageTask(
  conn: DB,
  actorId: string,
  organizationId: string,
  projectId: string,
  input: { title: string; description?: string | null }
) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const cols = await conn
    .select({ id: boardColumns.id, title: boardColumns.title })
    .from(boardColumns)
    .where(and(eq(boardColumns.organizationId, organizationId), eq(boardColumns.projectId, projectId)))
    .orderBy(asc(boardColumns.position));
  if (cols.length === 0) throw new AppError("NOT_FOUND", "Project not found");

  const titles = cols.map((c) => c.title) as [string, ...string[]];
  const schema = z.object({
    priority: priorityEnum,
    column: z.enum(titles),
    labels: z.array(z.string().max(24)).max(4),
    rationale: z.string().max(240),
  });

  const result = await generateStructured({
    schema,
    instructions:
      "You triage new engineering tasks. Pick a priority (urgent = production impact/security; high = bugs/customer-facing; low = docs/polish) and the most sensible starting column (usually the first one). Give a one-sentence rationale.",
    prompt: `Columns: ${titles.join(", ")}\n${wrapUntrusted({ Title: input.title, Description: input.description })}`,
    fallback: () => ({
      priority: heuristicPriority(`${input.title} ${input.description ?? ""}`),
      column: titles[0],
      labels: [],
      rationale: "Keyword-based suggestion (AI unavailable).",
    }),
    allow: () => consumeAiQuota(conn, organizationId),
  });
  const columnId = cols.find((c) => c.title === result.data.column)?.id ?? cols[0]!.id;
  return { ...result, columnId };
}

/* ------------------------- 4. conflict / change explainer ------------------------- */

type Fact = { actor: string; text: string; at: Date };

/** Deterministic facts from the audit log — the AI only rephrases, it never invents. */
export async function changeFacts(conn: DB, organizationId: string, taskId: string, sinceVersion: number) {
  const { task, key } = await loadTask(conn, organizationId, taskId);
  const ref = `${key}-${task.taskNumber}`;
  const cols = new Map(
    (await conn.select({ id: boardColumns.id, title: boardColumns.title }).from(boardColumns).where(eq(boardColumns.projectId, task.projectId))).map((c) => [c.id, c.title])
  );
  const logs = await conn
    .select({ action: auditLogs.action, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt, actor: users.name })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(and(eq(auditLogs.organizationId, organizationId), eq(auditLogs.entityId, taskId)))
    .orderBy(asc(auditLogs.createdAt))
    .limit(50);

  const facts: Fact[] = [];
  for (const l of logs) {
    const v = Number(l.metadata.version ?? 0);
    if (v <= sinceVersion) continue;
    const actor = l.actor ?? "A teammate";
    if (l.action === "TASK_MOVED") {
      facts.push({ actor, at: l.createdAt, text: `moved ${ref} to ${cols.get(String(l.metadata.targetColumnId)) ?? "another column"}` });
    } else if (l.action === "TASK_UPDATED") {
      const changes = (l.metadata.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
      for (const [field, c] of Object.entries(changes)) {
        if (field === "description") facts.push({ actor, at: l.createdAt, text: `edited the description of ${ref}` });
        else if (field === "assigneeId") facts.push({ actor, at: l.createdAt, text: `reassigned ${ref}` });
        else facts.push({ actor, at: l.createdAt, text: `changed ${field} of ${ref} from "${c.from}" to "${c.to}"` });
      }
    }
  }
  return { ref, task, facts };
}

export function describeFacts(facts: Fact[], now = Date.now()) {
  if (facts.length === 0) return "This card was changed by a teammate — the board has been synced.";
  const last = facts[facts.length - 1]!;
  const ago = Math.max(1, Math.round((now - last.at.getTime()) / 1000));
  const byActor = new Map<string, string[]>();
  for (const f of facts) byActor.set(f.actor, [...(byActor.get(f.actor) ?? []), f.text]);
  const parts = [...byActor].map(([actor, texts]) => `${actor} ${texts.join(" and ")}`);
  return `${parts.join("; ")} ${ago < 90 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago.`;
}

export async function explainConflict(conn: DB, actorId: string, organizationId: string, taskId: string, sinceVersion: number) {
  await requireOrgPermission(actorId, organizationId, "viewer", conn);
  const { facts } = await changeFacts(conn, organizationId, taskId, sinceVersion);
  const deterministic = describeFacts(facts);
  if (facts.length <= 1) return { data: { summary: deterministic }, provider: "fallback" as const };

  return generateStructured({
    schema: z.object({ summary: z.string().max(240) }),
    instructions:
      "Summarise concurrent edits to a Kanban card in ONE short plain-English sentence for the teammate whose change was rejected. Only use the facts given.",
    prompt: wrapUntrusted({ Facts: facts.map((f) => `${f.actor} ${f.text} at ${f.at.toISOString()}`).join("\n") }),
    fallback: () => ({ summary: deterministic }),
    allow: () => consumeAiQuota(conn, organizationId),
    timeoutMs: 8_000,
  });
}
