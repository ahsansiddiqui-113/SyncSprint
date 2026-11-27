import Link from "next/link";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { Eye, KeyRound, Link2Off } from "lucide-react";
import { db } from "@/db";
import { cn } from "@/lib/utils";
import { resolveShare, sharedView, unlockProof } from "@/server/services/share-links";
import { unlockShareAction } from "@/actions/share-public.actions";
import { Logo } from "@/components/ui/card";
import { ReadOnlyBoard } from "@/components/share/read-only-board";

export const metadata: Metadata = { title: "Shared board", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";


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

      <ReadOnlyBoard view={{ project: view.project, columns, includeComments: view.includeComments, tasks }} taskHref={(id) => qs({ task: id })} closeHref={qs({})} openTaskId={sp.task} />
    </Shell>
  );
}
