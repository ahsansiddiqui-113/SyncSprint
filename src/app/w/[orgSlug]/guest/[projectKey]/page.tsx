import { notFound, redirect } from "next/navigation";
import { Eye } from "lucide-react";
import { db } from "@/db";
import { AppError } from "@/lib/errors";
import { loadWorkspaceAnyState } from "@/server/page-guards";
import { guestProjectView } from "@/server/services/guests";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ReadOnlyBoard } from "@/components/share/read-only-board";
import { GuestCommentForm } from "@/components/share/guest-comment-form";

export const dynamic = "force-dynamic";

export default async function GuestBoard({ params, searchParams }: { params: Promise<{ orgSlug: string; projectKey: string }>; searchParams: Promise<{ task?: string }> }) {
  const { orgSlug, projectKey } = await params;
  const { task } = await searchParams;
  const { user, org, role, billing } = await loadWorkspaceAnyState(orgSlug);
  if (role !== "guest") redirect(`/w/${orgSlug}/projects/${projectKey}`);
  if (billing.access === "locked") redirect(`/w/${orgSlug}/locked`);
  const view = await guestProjectView(db, user.id, org.id, projectKey).catch((err) => {
    if (err instanceof AppError) notFound();
    throw err;
  });
  const base = `/w/${org.slug}/guest/${view.project.key}`;
  const canComment = billing.access === "full";
  return (
    <div className="min-h-full bg-canvas">
      <div className="border-b border-border bg-white px-6 py-4">
        <Breadcrumbs items={[{ label: org.name, href: `/w/${org.slug}/guest` }, { label: "Shared with you", href: `/w/${org.slug}/guest` }, { label: view.project.key }]} />
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{view.project.name}</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[13px] font-medium text-muted"><Eye className="h-3.5 w-3.5" /> Guest: view and comment</span>
        </div>
        <p className="text-[14px] text-muted">{view.tasks.length} tasks · refresh to see the latest</p>
      </div>
      <ReadOnlyBoard
        view={view}
        taskHref={(id) => `${base}?task=${id}`}
        closeHref={base}
        openTaskId={task}
        commentSlot={canComment ? (taskId) => <GuestCommentForm organizationId={org.id} taskId={taskId} /> : undefined}
      />
    </div>
  );
}
