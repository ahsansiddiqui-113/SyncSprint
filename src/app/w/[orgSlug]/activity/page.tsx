import Link from "next/link";
import { db } from "@/db";
import { loadWorkspace } from "@/server/page-guards";
import { AUDIT_ACTIONS, listAuditLogs, listMembers, taskRefs } from "@/server/services/workspace";
import { Card, PageHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ActivityFilters } from "@/components/workspace/activity-filters";
import { timeAgo } from "@/lib/utils";

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);

function describe(action: string, meta: Record<string, unknown>, ref: string | undefined) {
  const target = ref ?? (typeof meta.title === "string" ? meta.title : "a task");
  switch (action) {
    case "TASK_CREATED": return `created ${ref ?? meta.ref ?? target}`;
    case "TASK_MOVED": return `moved ${target}${meta.rebalanced ? " (column rebalanced)" : ""}`;
    case "TASK_UPDATED": return `updated ${Object.keys((meta.changes as object) ?? {}).join(", ") || "fields"} on ${target}`;
    case "TASK_DELETED": return `deleted “${meta.title}”`;
    case "COMMENT_ADDED": return `commented on ${target}: “${meta.preview}”`;
    case "PROJECT_CREATED": return `created project ${meta.key} · ${meta.name}`;
    case "MEMBER_ROLE_UPDATED": return `changed a role ${meta.from} → ${meta.to}${meta.demoSwitch ? " (demo switch)" : ""}`;
    case "INVITE_CREATED": return `invited ${meta.email} as ${meta.role}`;
    case "INVITE_ACCEPTED": return `joined as ${meta.role}`;
    case "INVITE_REVOKED": return `revoked invite for ${meta.email}`;
    case "AI_SUBTASKS_ADDED": return `added ${meta.count} AI-generated subtasks to ${target}`;
    case "ORG_CREATED": return `created the workspace`;
    case "CHECKLIST_ITEM_ADDED": return `added “${meta.text}” to the checklist of ${target}`;
    case "CHECKLIST_ITEM_DONE": return `checked off “${meta.text}” on ${target}`;
    case "CHECKLIST_ITEM_REOPENED": return `unchecked “${meta.text}” on ${target}`;
    case "CHECKLIST_ITEM_DELETED": return `removed “${meta.text}” from the checklist of ${target}`;
    case "TAG_CREATED": return `created the tag “${meta.name}”`;
    case "TAG_ADDED": return `tagged ${target} with “${meta.name}”`;
    case "TAG_REMOVED": return `removed the tag “${meta.name}” from ${target}`;
    case "DEPENDENCY_ADDED": return `marked ${target} as blocked by “${meta.blockerTitle ?? "another task"}”`;
    case "DEPENDENCY_REMOVED": return `removed a blocker from ${target}`;
    case "SPRINT_CREATED": return `created ${meta.name}`;
    case "SPRINT_UPDATED": return `updated a sprint`;
    case "SPRINT_STARTED": return `started ${meta.name} with ${meta.committedPoints} points committed`;
    case "SPRINT_COMPLETED": return `completed ${meta.name} · ${meta.completedPoints} of ${meta.committedPoints} points done${meta.carriedOver ? `, ${meta.carriedOver} carried over` : ""}`;
    case "SPRINT_DELETED": return `deleted ${meta.name}`;
    case "TIMER_STARTED": return `started a timer on ${target}`;
    case "TIME_LOGGED": return `logged ${fmtMin(Number(meta.minutes))} on ${target}${meta.via === "manual" ? "" : " (timer)"}`;
    case "ATTACHMENT_ADDED": return `attached “${meta.filename}” to ${target}`;
    case "ATTACHMENT_DELETED": return `removed the attachment “${meta.filename}” from ${target}`;
    case "ASSIGNEES_UPDATED": return `updated who's assigned to ${target}`;
    case "DOC_CREATED": return `created the doc “${meta.title}”`;
    case "DOC_UPDATED": return `edited a doc (version ${meta.version})`;
    case "DOC_DELETED": return `deleted the doc “${meta.title}”`;
    case "GOAL_CREATED": return `created the goal “${meta.title}”`;
    case "GOAL_DELETED": return `deleted the goal “${meta.title}”`;
    case "KEY_RESULT_UPDATED": return `checked in a key result at ${meta.currentValue}`;
    case "AUTOMATION_CREATED": return `created the automation “${meta.name}”`;
    case "AUTOMATION_UPDATED": return `updated the automation “${meta.name}”${meta.enabled === false ? " (off)" : ""}`;
    case "AUTOMATION_DELETED": return `deleted the automation “${meta.name}”`;
    case "AUTOMATION_RAN": return `triggered “${meta.automation}” on ${target}: ${Array.isArray(meta.did) ? meta.did.join(", ") : ""}`;
    case "RECURRENCE_SET": return meta.removed ? `stopped ${target} from repeating` : `set ${target} to repeat ${meta.frequency}${Number(meta.interval) > 1 ? ` every ${meta.interval}` : ""}`;
    case "TASKS_IMPORTED": return `imported ${meta.count} tasks into ${meta.key}`;
    case "API_KEY_CREATED": return `created the API key “${meta.name}” (${meta.scope})`;
    case "API_KEY_REVOKED": return `revoked the API key “${meta.name}”`;
    case "WEBHOOK_CREATED": return `added a webhook to ${meta.url}`;
    case "WEBHOOK_DELETED": return `removed the webhook to ${meta.url}`;
    default: return action.toLowerCase().replaceAll("_", " ");
  }
}

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ actor?: string; action?: string; before?: string }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { user, org } = await loadWorkspace(orgSlug);

  const action = AUDIT_ACTIONS.includes(sp.action as never) ? sp.action : undefined;
  const actorId = sp.actor && /^[0-9a-f-]{36}$/i.test(sp.actor) ? sp.actor : undefined;
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : undefined;

  const [logs, members] = await Promise.all([
    listAuditLogs(db, user.id, org.id, { actorId, action, before, limit: 50 }),
    listMembers(db, user.id, org.id),
  ]);
  const refs = await taskRefs(db, org.id, logs.filter((l) => l.entityType === "task").map((l) => l.entityId));
  const nextCursor = logs.length === 50 ? logs[logs.length - 1]!.createdAt.toISOString() : null;
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ ...(actorId && { actor: actorId }), ...(action && { action }), ...extra }).toString();

  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={org.name}
        title="Activity"
        description="Everything that happened in this workspace, newest first."
        actions={<ActivityFilters
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          actions={[...AUDIT_ACTIONS]}
          actor={actorId}
          action={action}
        />}
      />
      <Card className="relative overflow-hidden">
        {logs.length === 0 && <p className="p-6 text-center text-sm text-muted">No matching activity.</p>}
        {logs.map((l) => (
          <div key={l.id} className="relative flex items-start gap-3.5 border-b border-border px-5 py-3.5 transition-colors last:border-0 hover:bg-surface-2">
            <Avatar id={l.actorId ?? "x"} name={l.actorName ?? "Deleted user"} size={26} />
            <div className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{l.actorName ?? "Deleted user"}</span>{" "}
              <span className="text-muted">{describe(l.action, l.metadata, refs.get(l.entityId))}</span>
              <div className="mt-1 flex items-center gap-2">
                <Badge className="border-border-strong bg-surface-2 font-mono text-[12px] text-subtle">{l.action}</Badge>
                <span className="text-[13.5px] text-subtle" title={l.createdAt.toISOString()}>{timeAgo(l.createdAt)}</span>
              </div>
            </div>
          </div>
        ))}
      </Card>
      {nextCursor && (
        <div className="mt-4 text-center">
          <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${qs({ before: nextCursor })}`}>
            Older
          </Link>
        </div>
      )}
    </main>
  );
}
