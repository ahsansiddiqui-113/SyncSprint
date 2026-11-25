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
        description="Append-only audit trail. Every row is written in the same database transaction as the change it records."
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
