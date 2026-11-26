import { loadWorkspace } from "@/server/page-guards";
import { PageHeader } from "@/components/ui/card";
import { InboxList } from "@/components/workspace/inbox-list";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org } = await loadWorkspace(orgSlug);
  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={org.name}
        title="Inbox"
        description="Mentions, assignments, comments on work you follow, completed tasks and workload alerts."
      />
      <InboxList organizationId={org.id} meId={user.id} />
    </main>
  );
}
