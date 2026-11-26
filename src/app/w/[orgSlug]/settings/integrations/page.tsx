import { hasRole } from "@/lib/rbac-shared";
import { appBaseUrl } from "@/lib/base-url";
import { loadWorkspace } from "@/server/page-guards";
import { Card, PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Integrations } from "@/components/workspace/integrations";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { org, role } = await loadWorkspace(orgSlug);
  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: org.name, href: `/w/${org.slug}` }, { label: "Settings" }, { label: "Integrations" }]} />}
        title="Integrations"
        description="Connect SyncSprint to your own tools: a REST API with personal keys, and signed webhooks for task and comment events."
      />
      {hasRole(role, "admin") ? (
        <Integrations organizationId={org.id} baseUrl={appBaseUrl()} />
      ) : (
        <Card className="p-8 text-center text-[15px] text-muted">Only owners and admins can manage API keys and webhooks for this workspace.</Card>
      )}
    </main>
  );
}
