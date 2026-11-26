import { db } from "@/db";
import { isAdminRole } from "@/lib/rbac-shared";
import { loadWorkspace } from "@/server/page-guards";
import { getPortfolio } from "@/server/services/portfolio";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { PortfolioBoard } from "@/components/portfolio/portfolio-board";

export const metadata = { title: "Portfolio" };

export default async function PortfolioPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org, role } = await loadWorkspace(orgSlug);
  const data = await getPortfolio(db, user.id, org.id);
  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: org.name, href: `/w/${org.slug}` }, { label: "Portfolio" }]} />}
        title="Portfolio"
        description="Every project on one page: progress against time, overdue work, the active sprint and the latest status update."
      />
      <PortfolioBoard org={{ id: org.id, slug: org.slug }} canPost={isAdminRole(role)} initial={data} />
    </main>
  );
}
