import Link from "next/link";
import { CalendarDays, CheckSquare, MessageSquare, UsersRound, X } from "lucide-react";
import type { projectReadView } from "@/server/services/share-links";
import { cn } from "@/lib/utils";

type View = Awaited<ReturnType<typeof projectReadView>>;
const PRIORITY: Record<string, string> = { urgent: "text-rose-700 bg-rose-50", high: "text-amber-800 bg-amber-50", medium: "text-sky-800 bg-sky-50", low: "text-muted bg-surface-2" };

/**
 * A project's board, read-only, with a task panel. Used by public share links and by guests.
 * `taskHref` / `closeHref` keep navigation in the URL (server-rendered, no client state).
 * `commentSlot` renders under the comments of the open task (guests can comment).
 */
export function ReadOnlyBoard({ view, taskHref, closeHref, openTaskId, commentSlot }: { view: View; taskHref: (id: string) => string; closeHref: string; openTaskId?: string | null; commentSlot?: (taskId: string) => React.ReactNode }) {
  const { tasks, columns } = view;
  const open = openTaskId ? tasks.find((t) => t.id === openTaskId) : undefined;
  return (
    <>
      <main className="flex gap-4 overflow-x-auto p-6">
        {columns.map((c) => {
          const items = tasks.filter((t) => t.columnId === c.id);
          return (
            <section key={c.id} className="w-80 shrink-0 rounded-xl bg-surface-2/70 p-2.5" aria-label={c.title}>
              <h2 className="mb-2 flex items-center gap-2 px-1.5 text-[13px] font-bold uppercase tracking-wide text-muted">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color ?? "#94a3b8" }} /> {c.title} <span className="font-medium text-subtle">{items.length}</span>
              </h2>
              <div className="space-y-2">
                {items.map((t) => (
                  <Link key={t.id} href={taskHref(t.id)} scroll={false} className="block rounded-xl border border-border bg-white p-3 shadow-card hover:border-primary/40">
                    <div className="font-mono text-[12px] text-subtle">{t.ref}{t.parentRef ? ` · ↳ ${t.parentRef}` : ""}</div>
                    <div className="mt-0.5 text-[15px] font-medium leading-snug">{t.title}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px]">
                      <span className={cn("rounded px-1.5 py-0.5 font-medium capitalize", PRIORITY[t.priority])}>{t.priority}</span>
                      {t.team && <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium" style={{ color: t.team.color, backgroundColor: `${t.team.color}14` }}><UsersRound className="h-3 w-3" />{t.team.name}</span>}
                      {t.tags.map((g) => <span key={g.name} className="rounded px-1.5 py-0.5 font-medium" style={{ color: g.color, backgroundColor: `${g.color}14` }}>{g.name}</span>)}
                      {t.dueDate && <span className="inline-flex items-center gap-1 text-muted"><CalendarDays className="h-3 w-3" />{t.dueDate}</span>}
                      {t.checklist && <span className="inline-flex items-center gap-1 text-muted"><CheckSquare className="h-3 w-3" />{t.checklist.done}/{t.checklist.total}</span>}
                      {t.comments.length > 0 && <span className="inline-flex items-center gap-1 text-muted"><MessageSquare className="h-3 w-3" />{t.comments.length}</span>}
                    </div>
                    {t.assignee && <div className="mt-2 text-[13px] text-muted">{t.assignee}</div>}
                  </Link>
                ))}
                {items.length === 0 && <p className="px-2 py-3 text-[13.5px] text-subtle">Nothing here</p>}
              </div>
            </section>
          );
        })}
      </main>

      {open && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={open.title}>
          <Link href={closeHref} scroll={false} className="absolute inset-0 bg-[rgba(29,33,41,0.32)]" aria-label="Close" />
          <aside className="relative ml-auto h-full w-full max-w-xl overflow-y-auto border-l border-border-strong bg-white p-6 shadow-lift">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[13px] text-subtle">{open.ref} · {columns.find((c) => c.id === open.columnId)?.title}</div>
                <h2 className="mt-1 text-2xl font-bold leading-snug">{open.title}</h2>
              </div>
              <Link href={closeHref} scroll={false} aria-label="Close" className="rounded-md p-1.5 text-subtle hover:bg-hover"><X className="h-5 w-5" /></Link>
            </div>
            <dl className="mt-5 grid grid-cols-[8rem_1fr] gap-y-2 text-[14.5px]">
              <dt className="text-subtle">Priority</dt><dd className="capitalize">{open.priority}</dd>
              <dt className="text-subtle">Type</dt><dd className="capitalize">{open.type}</dd>
              <dt className="text-subtle">Assignee</dt><dd>{open.assignee ?? "Unassigned"}</dd>
              {open.team && (<><dt className="text-subtle">Group</dt><dd>{open.team.name}</dd></>)}
              <dt className="text-subtle">Dates</dt><dd>{open.startDate ?? "—"} → {open.dueDate ?? "—"}</dd>
              {open.storyPoints !== null && (<><dt className="text-subtle">Points</dt><dd>{open.storyPoints}</dd></>)}
              {open.checklist && (<><dt className="text-subtle">Checklist</dt><dd>{open.checklist.done} of {open.checklist.total} done</dd></>)}
            </dl>
            {open.description && (
              <section className="mt-6">
                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-subtle">Description</h3>
                <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{open.description}</p>
              </section>
            )}
            {view.includeComments && (
              <section className="mt-6">
                <h3 className="text-[13px] font-semibold uppercase tracking-wider text-subtle">Comments · {open.comments.length}</h3>
                <div className="mt-2 space-y-3">
                  {open.comments.length === 0 && <p className="text-[14.5px] text-subtle">No comments.</p>}
                  {open.comments.map((c, i) => (
                    <div key={i} className="rounded-xl border border-border bg-surface-2/60 px-3 py-2">
                      <div className="text-[13.5px] font-medium">{c.author} <span className="font-normal text-subtle">· {c.createdAt.slice(0, 10)}</span></div>
                      <p className="mt-0.5 whitespace-pre-wrap text-[14.5px]">{c.body}</p>
                    </div>
                  ))}
                </div>
                {commentSlot?.(open.id)}
              </section>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
