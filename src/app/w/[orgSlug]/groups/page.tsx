import { db } from "@/db";
import { loadWorkspace } from "@/server/page-guards";
import { listTeams } from "@/server/services/teams";
import { listMembers } from "@/server/services/workspace";
import { PageHeader } from "@/components/ui/card";
import { GroupsBoard } from "@/components/groups/groups-board";

export const metadata = { title: "Groups" };

export default async function GroupsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org, role } = await loadWorkspace(orgSlug);
  const [teams, members] = await Promise.all([listTeams(db, user.id, org.id), listMembers(db, user.id, org.id)]);
  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={org.name}
        title="Groups"
        description="Teams like QA, Developers or Marketing. Assign work to a group, mention everyone with @handle, and track each group's load and output."
      />
      <GroupsBoard
        org={{ id: org.id, slug: org.slug }}
        meId={user.id}
        role={role}
        initial={teams}
        members={members.map((m) => ({ id: m.userId, name: m.name, avatarUrl: m.avatarUrl, role: m.role }))}
      />
    </main>
  );
}
