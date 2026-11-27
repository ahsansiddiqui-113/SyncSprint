import { hasRole } from "@/lib/rbac-shared";
import { appBaseUrl } from "@/lib/base-url";
import { loadWorkspace } from "@/server/page-guards";
import { Card, PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Integrations } from "@/components/workspace/integrations";
import { ChatChannels } from "@/components/workspace/chat-channels";
import { RepoConnections } from "@/components/workspace/repo-connections";
import { db } from "@/db";
import { listProjects } from "@/server/services/workspace";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org, role } = await loadWorkspace(orgSlug);
  const { projects } = await listProjects(db, user.id, orgSlug);
  const projectList = projects.map((p) => ({ id: p.id, key: p.key, name: p.name }));
  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: org.name, href: `/w/${org.slug}` }, { label: "Settings" }, { label: "Integrations" }]} />}
        title="Integrations"
        description="Connect SyncSprint to your tools: a REST API and signed webhooks, chat alerts in Slack, Teams, Discord or Google Chat, and GitHub or GitLab links on your tasks."
      />
      {hasRole(role, "admin") ? (
        <>
          <Integrations organizationId={org.id} baseUrl={appBaseUrl()} />
          <ChatChannels organizationId={org.id} projects={projectList} />
          <RepoConnections organizationId={org.id} baseUrl={appBaseUrl()} />
        </>
      ) : (
        <Card className="p-8 text-center text-[15px] text-muted">Only owners and admins can manage API keys and webhooks for this workspace.</Card>
      )}
    </main>
  );
}
