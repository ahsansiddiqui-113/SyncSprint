import { isAdminRole } from "@/lib/rbac-shared";
import { appBaseUrl } from "@/lib/base-url";
import { loadWorkspaceAnyState } from "@/server/page-guards";
import { Card, PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { SecuritySettings } from "@/components/workspace/security-settings";

export const metadata = { title: "Security" };

export default async function SecuritySettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  // Any state: admins can still export their data while a workspace is read-only or locked.
  const { org, role } = await loadWorkspaceAnyState(orgSlug);
  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: org.name, href: `/w/${org.slug}` }, { label: "Settings" }, { label: "Security" }]} />}
        title="Security"
        description="Sign-in rules for everyone in this workspace, where it can be opened from, single sign-on, and exports of your data."
      />
      {isAdminRole(role) ? (
        <SecuritySettings org={{ id: org.id, slug: org.slug, name: org.name, isDemo: org.isDemo }} baseUrl={appBaseUrl()} />
      ) : (
        <Card className="p-8 text-center text-[15px] text-muted">Only this workspace&apos;s admins can change security settings.</Card>
      )}
    </main>
  );
}
