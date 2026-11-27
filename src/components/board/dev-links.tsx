"use client";

import { useCallback, useEffect, useState } from "react";
import { GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import { listDevLinksAction } from "@/actions/reach.actions";
import { useSignal } from "@/components/workspace/signals";
import { cn, timeAgo } from "@/lib/utils";

type Link = Extract<Awaited<ReturnType<typeof listDevLinksAction>>, { ok: true }>["links"][number];

/** Drawer section: commits, branches and pull requests that mention this task. Hidden when there are none. */
export function DevLinks({ organizationId, taskId }: { organizationId: string; taskId: string }) {
  const [links, setLinks] = useState<Link[]>([]);
  const load = useCallback(async () => {
    const r = await listDevLinksAction(organizationId, taskId);
    if (r.ok) setLinks(r.links);
  }, [organizationId, taskId]);
  useEffect(() => void load(), [load]);
  useSignal((e) => e.type === "TASK_META_CHANGED" && e.kind === "dev" && e.taskIds.includes(taskId) && void load());
  if (!links.length) return null;
  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-2 text-[14px] font-semibold uppercase tracking-wide text-subtle"><GitBranch className="h-4 w-4" /> Development</h3>
      <ul className="space-y-1.5">
        {links.map((l) => {
          const Icon = l.kind === "commit" ? GitCommitHorizontal : l.kind === "branch" ? GitBranch : l.state === "merged" ? GitMerge : l.state === "closed" ? GitPullRequestClosed : GitPullRequest;
          return (
            <li key={l.id}>
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 hover:bg-hover">
                <Icon className={cn("h-4 w-4 shrink-0", l.state === "merged" ? "text-violet-600" : l.state === "closed" ? "text-rose-600" : l.state === "open" ? "text-emerald-600" : "text-subtle")} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{l.title}</span>
                <span className="shrink-0 text-[12px] text-subtle">{l.repo} · {l.state === "pushed" ? "pushed" : l.state} {timeAgo(l.updatedAt)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
