import Link from "next/link";
import { ArrowUpRight, FolderKanban } from "lucide-react";
import { db } from "@/db";
import { can } from "@/lib/rbac";
import { loadWorkspace, orNotFound } from "@/server/page-guards";
import { listProjects } from "@/server/services/workspace";
import { Card, PageHeader } from "@/components/ui/card";
import { CreateProjectForm } from "@/components/workspace/create-project-form";

const GRADIENTS = ["from-violet-500/30 to-indigo-500/5", "from-sky-500/30 to-cyan-500/5", "from-emerald-500/30 to-teal-500/5", "from-amber-500/30 to-orange-500/5"];

export default async function ProjectsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org, role } = await loadWorkspace(orgSlug);
  const { projects } = await orNotFound(() => listProjects(db, user.id, orgSlug));

  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader eyebrow={org.name} title="Projects" description="Each project has its own board, task numbering and real-time activity." />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {projects.map((p, i) => (
          <Link key={p.id} href={`/w/${org.slug}/projects/${p.key}`} className="group">
            <Card className="relative h-full overflow-hidden p-5 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-border-strong group-hover:shadow-lift">
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b ${GRADIENTS[i % GRADIENTS.length]} opacity-60`} />
              <div className="relative flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-strong bg-surface-2 font-mono text-[13px] font-bold">{p.key}</span>
                <ArrowUpRight className="h-4 w-4 text-subtle transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
              </div>
              <h2 className="relative mt-5 text-xl font-semibold tracking-tight">{p.name}</h2>
              <p className="relative mt-1 line-clamp-2 min-h-10 text-sm text-muted">{p.description ?? "No description"}</p>
              <div className="relative mt-4 flex items-center gap-2 text-[14px] text-subtle">
                <FolderKanban className="h-3.5 w-3.5" /> {p.taskCount} tasks
              </div>
            </Card>
          </Link>
        ))}
        {projects.length === 0 && (
          <Card className="col-span-full flex flex-col items-center border-dashed p-12 text-center">
            <FolderKanban className="h-6 w-6 text-subtle" />
            <p className="mt-3 font-medium">No projects yet</p>
            <p className="text-sm text-muted">Admins and owners can create the first one below.</p>
          </Card>
        )}
      </div>

      {can(role, "MANAGE_PROJECTS") ? (
        <Card className="mt-10 p-6">
          <h2 className="font-semibold tracking-tight">New project</h2>
          <p className="mb-4 mt-1 text-sm text-muted">Creates a board with Backlog, In Progress, Review and Done.</p>
          <CreateProjectForm organizationId={org.id} orgSlug={org.slug} />
        </Card>
      ) : (
        <p className="mt-10 text-[15px] text-subtle">Only admins and owners can create projects.</p>
      )}
    </main>
  );
}
