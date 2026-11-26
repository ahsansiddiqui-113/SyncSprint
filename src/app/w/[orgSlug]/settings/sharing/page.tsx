import { db } from "@/db";
import { isAdminRole } from "@/lib/rbac-shared";
import { loadWorkspace } from "@/server/page-guards";
import { listProjects } from "@/server/services/workspace";
import { Card, PageHeader } from "@/components/ui/card";
import { ShareLinksManager } from "@/components/workspace/share-links";

export const metadata = { title: "Share links" };

export default async function SharingPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org, role } = await loadWorkspace(orgSlug);
  const { projects } = await listProjects(db, user.id, orgSlug);
  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={org.name}
        title="Share links"
        description="Read-only links for people without an account, like clients or stakeholders. They can view, never change anything."
      />
      {isAdminRole(role) ? (
        <ShareLinksManager organizationId={org.id} projects={projects.map((p) => ({ id: p.id, key: p.key, name: p.name }))} />
      ) : (
        <Card className="p-8 text-center text-[15px] text-muted">Only admins can create or manage share links.</Card>
      )}
    </main>
  );
}
