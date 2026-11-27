import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderKanban } from "lucide-react";
import { db } from "@/db";
import { loadWorkspaceAnyState } from "@/server/page-guards";
import { guestProjects } from "@/server/services/guests";
import { Card, PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

export const metadata = { title: "Shared with you" };

export default async function GuestHome({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { user, org, role, billing } = await loadWorkspaceAnyState(orgSlug);
  if (role !== "guest") redirect(`/w/${orgSlug}`);
  if (billing.access === "locked") redirect(`/w/${orgSlug}/locked`);
  const projects = await guestProjects(db, user.id, org.id);
  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: org.name, href: `/w/${org.slug}/guest` }, { label: "Shared with you" }]} />}
        title="Shared with you"
        description={`You're a guest in ${org.name}: you can see these projects and comment on their tasks.`}
      />
      {projects.length === 0 ? (
        <Card className="p-10 text-center text-[15px] text-muted">Nothing has been shared with you yet. Ask your contact at {org.name} to add you to a project.</Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} href={`/w/${org.slug}/guest/${p.key}`}>
              <Card className="h-full p-5 transition-shadow hover:shadow-lift">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-strong bg-surface-2 font-mono text-[13px] font-bold">{p.key}</span>
                <h2 className="mt-4 text-lg font-semibold">{p.name}</h2>
                {p.description && <p className="mt-1 line-clamp-2 text-[14px] text-muted">{p.description}</p>}
                <p className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] text-subtle"><FolderKanban className="h-3.5 w-3.5" /> Open board</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
