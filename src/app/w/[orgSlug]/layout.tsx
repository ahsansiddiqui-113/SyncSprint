import { db } from "@/db";
import { loadWorkspace } from "@/server/page-guards";
import { listMyOrganizations, listProjects } from "@/server/services/workspace";
import { Sidebar } from "@/components/workspace/sidebar";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { user, org, role } = await loadWorkspace(orgSlug);
  const [orgs, { projects }] = await Promise.all([listMyOrganizations(db, user.id), listProjects(db, user.id, orgSlug)]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        user={{ id: user.id, name: user.name, email: user.email, image: user.image ?? null }}
        org={{ id: org.id, slug: org.slug, name: org.name, isDemo: org.isDemo }}
        role={role}
        orgs={orgs.map((o) => ({ slug: o.slug, name: o.name }))}
        projects={projects.map((p) => ({ key: p.key, name: p.name, taskCount: p.taskCount }))}
      />
      <div className="relative min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
