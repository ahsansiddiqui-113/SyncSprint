import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { CalendarDays, CheckSquare, Eye, KeyRound, Link2Off, MessageSquare, UsersRound, X } from "lucide-react";
import { db } from "@/db";
import { cn } from "@/lib/utils";
import { resolveShare, sharedView, unlockProof } from "@/server/services/share-links";
import { unlockShareAction } from "@/actions/share-public.actions";
import { Logo } from "@/components/ui/card";

export const metadata: Metadata = { title: "Shared board", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PRIORITY: Record<string, string> = { urgent: "text-rose-700 bg-rose-50", high: "text-amber-800 bg-amber-50", medium: "text-sky-800 bg-sky-50", low: "text-muted bg-surface-2" };

function Shell({ children, orgName }: { children: React.ReactNode; orgName?: string }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex items-center gap-3 border-b border-border bg-white px-6 py-3">
        <Logo className="text-[15px] [&_svg]:h-6 [&_svg]:w-6" />
        {orgName && <span className="text-[14.5px] text-muted">· shared by {orgName}</span>}
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[13px] font-medium text-muted">
          <Eye className="h-3.5 w-3.5" /> View only
        </span>
      </header>
      {children}
    </div>
  );
}

export default async function SharedPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ project?: string; task?: string; error?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const share = await resolveShare(db, token);
  if (!share) {
    return (
      <Shell>
        <main className="flex min-h-[70vh] flex-col items-center justify-center gap-3 p-8 text-center">
          <Link2Off className="h-10 w-10 text-subtle" />
          <h1 className="text-2xl font-bold">This link isn&apos;t available</h1>
          <p className="max-w-md text-[15.5px] text-muted">It may have expired or been turned off. Ask the person who shared it for a new link.</p>
        </main>
      </Shell>
    );
  }

  if (share.link.passwordHash) {
    const cookie = (await cookies()).get(`ss_share_${share.link.id}`)?.value;
    if (cookie !== unlockProof(share.link)) {
      return (
        <Shell orgName={share.orgName}>
          <main className="flex min-h-[70vh] items-center justify-center p-8">
            <form action={unlockShareAction.bind(null, token)} className="w-full max-w-sm rounded-2xl border border-border bg-white p-6 shadow-card">
              <KeyRound className="h-7 w-7 text-primary" />
              <h1 className="mt-3 text-xl font-bold">Password required</h1>
              <p className="mt-1 text-[14.5px] text-muted">{share.orgName} protected this link. Enter the password they gave you.</p>
              <input
                name="password"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                aria-label="Password"
                className="mt-4 h-11 w-full rounded-lg border border-border-strong px-3 text-[15px] outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
              />
              {sp.error && (
                <p className="mt-2 text-[14px] text-rose-600" role="alert">
                  {sp.error === "limited" ? "Too many attempts. Try again in 15 minutes." : "That password isn't right."}
                </p>
              )}
              <button className="mt-4 h-11 w-full cursor-pointer rounded-lg bg-primary text-[15px] font-medium text-white hover:bg-primary-dark">View</button>
            </form>
          </main>
        </Shell>
      );
    }
  }

  const view = await sharedView(db, share, sp.project);
  const base = `/s/${token}`;
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const project = extra.project ?? (view.scope === "workspace" ? view.project?.key : undefined);
    if (project) p.set("project", project);
    if (extra.task) p.set("task", extra.task);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };

  if (!view.project) {
    return (
      <Shell orgName={view.orgName}>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <h1 className="text-3xl font-bold tracking-tight">{view.orgName}</h1>
          <p className="mt-1 text-[15.5px] text-muted">Projects shared with you (view only).</p>
          <div className="mt-6 grid gap-3">
            {view.projects.map((p) => (
              <Link key={p.id} href={qs({ project: p.key })} className="rounded-xl border border-border bg-white p-4 shadow-card hover:border-primary/40">
                <div className="font-semibold"><span className="mr-2 font-mono text-[13px] text-subtle">{p.key}</span>{p.name}</div>
                {p.description && <p className="mt-1 text-[14.5px] text-muted">{p.description}</p>}
              </Link>
            ))}
          </div>
        </main>
      </Shell>
    );
  }

  const tasks = view.tasks ?? [];
  const columns = view.columns ?? [];
  const open = sp.task ? tasks.find((t) => t.id === sp.task) : undefined;

  return (
    <Shell orgName={view.orgName}>
      <div className="border-b border-border bg-white px-6 py-4">
        {view.scope === "workspace" && (
          <nav className="mb-2 flex flex-wrap gap-1" aria-label="Projects">
            {view.projects.map((p) => (
              <Link key={p.id} href={qs({ project: p.key })} className={cn("rounded-lg px-2.5 py-1 text-[14px] font-medium", p.key === view.project!.key ? "bg-primary-soft text-primary" : "text-muted hover:bg-hover")}>
                {p.key} · {p.name}
              </Link>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-bold tracking-tight">{view.project.name}</h1>
        <p className="text-[14.5px] text-muted">{tasks.length} tasks · refresh the page to see the latest</p>
      </div>

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
                  <Link key={t.id} href={qs({ task: t.id })} scroll={false} className="block rounded-xl border border-border bg-white p-3 shadow-card hover:border-primary/40">
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
          <Link href={qs({})} scroll={false} className="absolute inset-0 bg-[rgba(29,33,41,0.32)]" aria-label="Close" />
          <aside className="relative ml-auto h-full w-full max-w-xl overflow-y-auto border-l border-border-strong bg-white p-6 shadow-lift">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[13px] text-subtle">{open.ref} · {columns.find((c) => c.id === open.columnId)?.title}</div>
                <h2 className="mt-1 text-2xl font-bold leading-snug">{open.title}</h2>
              </div>
              <Link href={qs({})} scroll={false} aria-label="Close" className="rounded-md p-1.5 text-subtle hover:bg-hover"><X className="h-5 w-5" /></Link>
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
                      <div className="text-[13.5px] font-medium">{c.author} <span className="font-normal text-subtle">· {new Date(c.createdAt).toLocaleDateString()}</span></div>
                      <p className="mt-0.5 whitespace-pre-wrap text-[14.5px]">{c.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      )}
    </Shell>
  );
}
