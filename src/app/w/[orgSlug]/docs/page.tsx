import Link from "next/link";
import { FileText, Link2 } from "lucide-react";
import { db } from "@/db";
import { can } from "@/lib/rbac-shared";
import { timeAgo } from "@/lib/utils";
import { loadWorkspace } from "@/server/page-guards";
import { listDocs } from "@/server/services/docs";
import { Card, PageHeader } from "@/components/ui/card";
import { NewDocButton } from "@/components/docs/new-doc-button";

export const metadata = { title: "Docs" };

/** Strip markdown syntax for a one-line preview. */
const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-|[\]()!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export default async function DocsPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { orgSlug } = await params;
  const { q } = await searchParams;
  const { user, org, role } = await loadWorkspace(orgSlug);
  const docs = await listDocs(db, user.id, org.id, { q });

  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader
        eyebrow={org.name}
        title="Docs"
        description="Specs, runbooks, meeting notes and decisions — written in markdown and linked to the work they describe."
        actions={can(role, "CREATE_OR_MOVE_TASK") ? <NewDocButton organizationId={org.id} orgSlug={org.slug} /> : null}
      />
      <form className="mb-5">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search docs by title…"
          aria-label="Search docs"
          className="h-11 w-full max-w-md rounded-lg border border-border-strong bg-white px-3.5 text-[15px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
        />
      </form>
      {docs.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <FileText className="h-8 w-8 text-subtle" />
          <p className="text-[16px] font-medium">{q ? "No docs match that search" : "No docs yet"}</p>
          <p className="text-[15px] text-subtle">{q ? "Try a different title." : "Create the first page for your team's knowledge."}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {docs.map((d) => (
            <Link key={d.id} href={`/w/${org.slug}/docs/${d.id}`} className="group">
              <Card className="h-full p-5 transition group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-lift">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <FileText className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[17px] font-semibold group-hover:text-primary">{d.title}</h2>
                    <p className="mt-1 line-clamp-2 text-[14.5px] text-muted">{plain(d.excerpt) || "Empty page"}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3 text-[13px] text-subtle">
                  <span>
                    Edited {timeAgo(d.updatedAt)}
                    {d.updatedByName ? ` by ${d.updatedByName}` : ""}
                  </span>
                  {d.linkedTasks > 0 && (
                    <span className="ml-auto inline-flex items-center gap-1">
                      <Link2 className="h-3.5 w-3.5" /> {d.linkedTasks} task{d.linkedTasks === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
