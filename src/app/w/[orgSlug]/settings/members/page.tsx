import { db } from "@/db";
import { can } from "@/lib/rbac";
import { loadWorkspace } from "@/server/page-guards";
import { listInvites, listMembers } from "@/server/services/workspace";
import { Card, PageHeader } from "@/components/ui/card";
import { MembersTable } from "@/components/workspace/members-table";
import { InvitePanel } from "@/components/workspace/invite-panel";

export default async function MembersPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org, role } = await loadWorkspace(orgSlug);
  const canManage = can(role, "INVITE_OR_CHANGE_ROLES");
  const [members, invites] = await Promise.all([
    listMembers(db, user.id, org.id),
    canManage ? listInvites(db, user.id, org.id) : Promise.resolve([]),
  ]);

  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={org.name}
        title="Members"
        description={<>Role hierarchy: <b className="text-foreground">owner › admin › member › viewer</b>. Every change is re-checked on the server and written to the audit log.</>}
      />
      <Card className="overflow-hidden">
        <MembersTable
          organizationId={org.id}
          currentUserId={user.id}
          actorRole={role}
          members={members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }))}
        />
      </Card>
      {canManage ? (
        <InvitePanel
          organizationId={org.id}
          actorRole={role}
          invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role, token: i.token, expiresAt: i.expiresAt.toISOString() }))}
        />
      ) : (
        <p className="mt-6 text-xs text-muted">Only admins and owners can invite people or change roles.</p>
      )}
    </main>
  );
}
