import Link from "next/link";
import { ArrowRight, Check, Database, GitBranch, Lock, Radio, ScrollText, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { DemoButton } from "@/components/auth/demo-button";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/ui/card";
import { PriorityFlag, StatusPill, DONE_COLOR } from "@/components/ui/badge";
import { getSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/db/schema";

const FEATURES = [
  { icon: Lock, color: "#7b68ee", title: "Tenant isolation", body: "Every query is scoped by organizationId after a server-side membership check. Smuggled ids from other tenants resolve to 404.", tag: "requireOrgPermission()" },
  { icon: ShieldCheck, color: "#2db87d", title: "Server-enforced RBAC", body: "owner › admin › member › viewer, checked in one guard on every action — hiding a button is never the security boundary.", tag: "ROLE_WEIGHT" },
  { icon: Radio, color: "#49ccf9", title: "Real-time rooms", body: "Authenticated WebSocket rooms per org with live presence, “editing…” indicators and reconnect-resync.", tag: "org:{orgId}" },
  { icon: GitBranch, color: "#ff9800", title: "Optimistic concurrency", body: "Version-checked UPDATEs reject stale writes; the client rolls back and explains exactly what a teammate changed.", tag: "VERSION_CONFLICT" },
  { icon: Zap, color: "#e44a8a", title: "O(1) reordering", body: "Fractional indexing writes one row per drag, with automatic column rebalancing when float gaps run out.", tag: "computeDropPosition()" },
  { icon: ScrollText, color: "#f5a623", title: "Immutable audit log", body: "Each mutation writes its audit row in the same transaction — it all commits, or none of it does.", tag: "db.transaction()" },
];

type PreviewCard = { ref: string; title: string; p: TaskPriority; who?: string; live?: string };
const PREVIEW: { title: string; color: string; cards: PreviewCard[] }[] = [
  { title: "Backlog", color: "#87909e", cards: [
    { ref: "ENG-1", title: "Multi-tenant billing webhook", p: "high", who: "AR" },
    { ref: "ENG-3", title: "Migrate session store", p: "low" },
  ] },
  { title: "In Progress", color: "#7b68ee", cards: [
    { ref: "ENG-5", title: "Fix N+1 on project list", p: "urgent", who: "SC", live: "Sara editing…" },
    { ref: "ENG-6", title: "SAML SSO for enterprise", p: "high", who: "AR" },
  ] },
  { title: "Review", color: "#ff9800", cards: [{ ref: "ENG-8", title: "Row-level security policies", p: "high", who: "SC" }] },
  { title: "Done", color: DONE_COLOR, cards: [{ ref: "ENG-12", title: "Fractional indexing", p: "medium", who: "PP" }] },
];

const AVATAR: Record<string, string> = {
  AR: "from-violet-400 to-purple-600",
  SC: "from-sky-400 to-blue-600",
  PP: "from-emerald-400 to-teal-600",
};

function BoardPreview() {
  return (
    <div className="relative mx-auto mt-16 max-w-6xl">
      <div className="absolute -inset-x-16 -top-12 bottom-10 -z-10 rounded-[48px] bg-linear-to-br from-[#8930fd]/25 via-[#fd71af]/20 to-[#49ccf9]/25 blur-3xl" />
      <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-[0_30px_80px_-20px_rgba(41,45,52,0.35)]">
        {/* fake app chrome */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="ml-2 flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-white">EN</span>
          <span className="text-[15px] font-bold">Platform Engineering</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
          </span>
          <div className="ml-auto flex -space-x-2">
            {Object.entries(AVATAR).map(([k, c]) => (
              <span key={k} className={cn("flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-br text-[10px] font-bold text-white ring-2 ring-white", c)}>{k}</span>
            ))}
          </div>
        </div>
        <div className="flex gap-1 border-b border-border px-5 text-[14px] font-medium">
          <span className="border-b-2 border-primary px-3 py-2 text-primary">Board</span>
          <span className="px-3 py-2 text-muted">List</span>
        </div>
        <div className="grid grid-cols-2 gap-3 bg-canvas p-5 sm:grid-cols-4">
          {PREVIEW.map((col) => (
            <div key={col.title} className="rounded-xl p-2" style={{ backgroundColor: `${col.color}14` }}>
              <div className="mb-2 px-1 pt-1">
                <StatusPill title={col.title} color={col.color} count={col.cards.length} />
              </div>
              <div className="space-y-2">
                {col.cards.map((c) => (
                  <div key={c.ref} className={cn("rounded-lg border bg-white p-3 text-left shadow-card", c.live ? "border-primary/50 ring-2 ring-primary/15" : "border-border")}>
                    <div className="flex items-center gap-1.5 text-[12px] text-subtle">
                      {c.ref}
                      {c.live && (
                        <span className="ml-auto rounded-full bg-primary-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-primary">{c.live}</span>
                      )}
                    </div>
                    <p className={cn("mt-1 text-[14px] font-medium leading-snug", col.title === "Done" && "text-muted line-through decoration-black/25")}>{c.title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      {c.who ? (
                        <span className={cn("flex h-5 w-5 items-center justify-center rounded-full bg-linear-to-br text-[8px] font-bold text-white", AVATAR[c.who])}>{c.who}</span>
                      ) : (
                        <span className="h-5 w-5 rounded-full border border-dashed border-border-strong" />
                      )}
                      <PriorityFlag priority={c.p} size={13} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* floating conflict toast */}
      <div className="absolute -bottom-8 -right-4 hidden w-96 rounded-xl border border-border bg-white p-4 text-left shadow-lift sm:block">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><GitBranch className="h-4 w-4" /></span>
          <div>
            <p className="text-[14px] font-semibold">Card updated by a teammate — board synced</p>
            <p className="mt-0.5 text-[13px] text-muted">Alex moved ENG-104 to Review and raised priority to High 12s ago.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const session = await getSession();
  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      <nav className="sticky top-0 z-30 border-b border-border/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-8 py-4">
          <Logo />
          <div className="flex items-center gap-2">
            <a href="#features" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}>Features</a>
            <a href="#architecture" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}>Architecture</a>
            {session ? (
              <Link href="/w" className={buttonVariants({ size: "sm" })}>
                Open workspaces <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className={buttonVariants({ variant: "outline", size: "sm" })}>Log in</Link>
                <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>Sign up</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <main className="relative mx-auto max-w-[1440px] px-8 pb-28">
        <section className="pt-20 text-center">
          <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary-soft px-4 py-1.5 text-[14px] font-medium text-primary">
            <Sparkles className="h-4 w-4" />
            Multi-tenant · RBAC · Real-time · $0 AI
          </div>
          <h1 className="mx-auto max-w-5xl text-5xl font-extrabold leading-[1.05] tracking-[-0.035em] text-foreground sm:text-7xl">
            One board for your team. <span className="text-gradient">Always in sync.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[19px] leading-relaxed text-muted">
            Plan sprints, move work and see teammates live — with strict tenant isolation, server-enforced roles,
            conflict-safe drag-and-drop and AI that costs nothing to run.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <DemoButton />
            <Link href="#architecture" className={buttonVariants({ variant: "outline", size: "lg" })}>How it works</Link>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[15px] text-muted">
            {["No signup needed", "Your own private workspace", "Teammates in every role"].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-[#2db87d]" /> {t}</span>
            ))}
          </div>
        </section>

        <BoardPreview />

        <section id="features" className="mt-36">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="text-[14px] font-bold uppercase tracking-wider text-primary">Built like real B2B SaaS</p>
            <h2 className="mt-2 text-4xl font-extrabold tracking-tight">Everything a reviewer looks for — built in and tested.</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="group rounded-2xl border border-border bg-white p-7 shadow-card transition-all hover:-translate-y-1 hover:shadow-lift">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl text-white" style={{ backgroundColor: f.color }}>
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-[19px] font-bold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.body}</p>
                <code className="mt-5 inline-block rounded-md bg-surface-2 px-2 py-1 font-mono text-[13px] text-muted">{f.tag}</code>
              </div>
            ))}
          </div>
        </section>

        <section id="architecture" className="mt-36 grid gap-12 lg:grid-cols-[1fr_1.25fr] lg:items-center">
          <div>
            <p className="text-[14px] font-bold uppercase tracking-wider text-primary">Request lifecycle</p>
            <h2 className="mt-2 text-4xl font-extrabold tracking-tight">Optimistic on the client. Authoritative on the server.</h2>
            <ol className="mt-8 space-y-5 text-[16px] text-muted">
              {[
                ["Drag", "The card moves instantly; a midpoint position is computed locally.", "#7b68ee"],
                ["Verify", "The server action derives the actor from the session, checks role + tenant, then runs a version-checked UPDATE.", "#49ccf9"],
                ["Commit", "Version bump and audit row commit in one transaction — or the client gets VERSION_CONFLICT and rolls back.", "#ff9800"],
                ["Broadcast", "Only after commit, the event fans out to the org room; peers drop stale packets by version.", "#2db87d"],
              ].map(([t, d, c], i) => (
                <li key={t} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white" style={{ backgroundColor: c }}>{i + 1}</span>
                  <span><b className="font-semibold text-foreground">{t}.</b> {d}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-2xl border border-border bg-white p-6 shadow-lift">
            <div className="grid grid-cols-3 gap-3 text-center text-[14px]">
              {[
                { icon: Zap, t: "Browser", s: "@dnd-kit · reducer", c: "#7b68ee" },
                { icon: ShieldCheck, t: "Server Action", s: "RBAC + tenant guard", c: "#49ccf9" },
                { icon: Database, t: "Postgres", s: "OCC + audit tx", c: "#2db87d" },
              ].map((n) => (
                <div key={n.t} className="rounded-xl border border-border bg-surface-2 p-4">
                  <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ backgroundColor: n.c }}>
                    <n.icon className="h-4 w-4" />
                  </span>
                  <div className="mt-2 font-semibold">{n.t}</div>
                  <div className="text-[13px] text-subtle">{n.s}</div>
                </div>
              ))}
            </div>
            <pre className="mt-5 overflow-x-auto rounded-xl bg-[#1e1f26] p-5 font-mono text-[13.5px] leading-relaxed text-[#d4d6dd]">{`UPDATE tasks
   SET column_id = $1, position = $2,
       version   = version + 1
 WHERE id = $3
   AND organization_id = $4   -- tenant scope
   AND version = $5           -- optimistic lock
RETURNING *;                  -- 0 rows ⇒ VERSION_CONFLICT`}</pre>
            <div className="mt-5 flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary-soft px-4 py-3 text-[14px] text-primary">
              <Sparkles className="h-4 w-4 shrink-0" />
              AI: OpenRouter → Gemini → Groq free tiers, schema-validated, with a deterministic fallback.
            </div>
          </div>
        </section>

        <section className="mt-36 overflow-hidden rounded-3xl bg-linear-to-br from-[#7b68ee] via-[#8e5cf0] to-[#e44a8a] px-8 py-16 text-center text-white">
          <h2 className="text-4xl font-extrabold tracking-tight">See it in 10 seconds.</h2>
          <p className="mx-auto mt-3 max-w-lg text-[17px] text-white/85">No signup. Your own isolated workspace with teammates in every role.</p>
          <div className="mt-8 flex justify-center">
            <DemoButton variant="inverse" />
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-10 text-center text-[14px] text-subtle">
        Next.js · Drizzle · PostgreSQL · Better Auth · WebSockets · Vercel AI SDK
      </footer>
    </div>
  );
}
