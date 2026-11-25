import Link from "next/link";
import { ArrowUpRight, FolderKanban, ListChecks, Play, Plus, Users } from "lucide-react";
import { db } from "@/db";
import { requireUserOrRedirect } from "@/lib/session";
import { listMyOrganizations } from "@/server/services/workspace";
import { Avatar } from "@/components/ui/avatar";
import { RoleBadge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/card";
import { CreateOrgForm } from "@/components/workspace/create-org-form";
import { SignOutButton } from "@/components/workspace/sign-out-button";
import { DemoButton } from "@/components/auth/demo-button";

const TILE_GRADIENTS = [
  "from-[#8930fd] to-[#49ccf9]",
  "from-[#ff02f0] to-[#ffc800]",
  "from-[#0f9d74] to-[#49ccf9]",
  "from-[#dd6b00] to-[#ff02f0]",
  "from-[#3f7cb8] to-[#8a5cf6]",
];

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function WorkspacesPage() {
  const user = await requireUserOrRedirect("/w");
  const orgs = await listMyOrganizations(db, user.id);
  const firstName = user.name.split(" ")[0];

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-white/90 backdrop-blur">
        <div className="flex h-16 w-full items-center gap-4 px-8 2xl:px-14">
          <Link href="/"><Logo /></Link>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden items-center gap-2.5 sm:flex">
              <Avatar id={user.id} name={user.name} src={user.image} size={34} />
              <div className="leading-tight">
                <div className="text-[15px] font-semibold">{user.name}</div>
                <div className="text-[13px] text-subtle">{user.email}</div>
              </div>
            </div>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="w-full flex-1 px-8 py-10 2xl:px-14">
        {/* hero */}
        <section className="relative overflow-hidden rounded-2xl bg-linear-to-br from-[#7b68ee] via-[#8e5cf0] to-[#e44a8a] px-10 py-10 text-white shadow-lift">
          <div className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-[#49ccf9]/30 blur-3xl" />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-[15px] font-medium text-white/80">{greeting()}, {firstName} 👋</p>
              <h1 className="mt-1 text-4xl font-extrabold tracking-tight">Your workspaces</h1>
              <p className="mt-2 max-w-xl text-[16px] text-white/85">
                {orgs.length
                  ? `You belong to ${orgs.length} workspace${orgs.length === 1 ? "" : "s"}. Pick one to jump into its boards, calendar and dashboards.`
                  : "Create your first workspace, or explore a fully seeded demo with teammates in every role."}
              </p>
            </div>
            <div className="flex gap-6 text-white">
              {[
                { label: "Workspaces", value: orgs.length },
                { label: "Projects", value: orgs.reduce((s, o) => s + o.projectCount, 0) },
                { label: "Tasks", value: orgs.reduce((s, o) => s + o.taskCount, 0) },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-white/15 px-5 py-3 backdrop-blur">
                  <div className="text-3xl font-bold tabular-nums">{s.value}</div>
                  <div className="text-[13px] font-medium text-white/80">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* workspace grid */}
        <div className="mb-4 mt-10 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">All workspaces</h2>
          <span className="text-[14px] text-subtle">{orgs.length} total</span>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {orgs.map((o, i) => (
            <Link key={o.id} href={`/w/${o.slug}`} className="group">
              <article className="flex h-full flex-col rounded-2xl border border-border bg-white p-6 shadow-card transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-border-strong group-hover:shadow-lift">
                <div className="flex items-start justify-between">
                  <span className={`flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br text-xl font-bold text-white ${TILE_GRADIENTS[i % TILE_GRADIENTS.length]}`}>
                    {o.name[0]}
                  </span>
                  <ArrowUpRight className="h-5 w-5 text-subtle transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
                <h3 className="mt-4 truncate text-[19px] font-bold tracking-tight">{o.name}</h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <RoleBadge role={o.role} />
                  {o.isDemo && <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[13px] font-medium text-amber-700">Demo</span>}
                  <span className="text-[13px] text-subtle">/{o.slug}</span>
                </div>
                <div className="mt-auto grid grid-cols-3 gap-2 border-t border-border pt-4 text-center">
                  {[
                    { icon: FolderKanban, label: "Projects", value: o.projectCount },
                    { icon: ListChecks, label: "Tasks", value: o.taskCount },
                    { icon: Users, label: "Members", value: o.memberCount },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="flex items-center justify-center gap-1.5 text-[18px] font-bold tabular-nums">
                        <s.icon className="h-4 w-4 text-subtle" /> {s.value}
                      </div>
                      <div className="text-[12.5px] text-subtle">{s.label}</div>
                    </div>
                  ))}
                </div>
              </article>
            </Link>
          ))}

          {/* create card */}
          <article className="flex h-full flex-col rounded-2xl border-2 border-dashed border-border-strong bg-white/60 p-6">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Plus className="h-6 w-6" />
            </span>
            <h3 className="mt-4 text-[19px] font-bold tracking-tight">New workspace</h3>
            <p className="mb-4 mt-1 text-[14px] text-muted">You&apos;ll be its owner and can invite teammates with roles.</p>
            <div className="mt-auto">
              <CreateOrgForm />
            </div>
          </article>

          {/* demo card */}
          <article className="flex h-full flex-col rounded-2xl border border-primary/20 bg-linear-to-br from-primary-soft to-white p-6">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white">
              <Play className="h-5 w-5 fill-current" />
            </span>
            <h3 className="mt-4 text-[19px] font-bold tracking-tight">Try the demo</h3>
            <p className="mb-4 mt-1 text-[14px] text-muted">
              A private &ldquo;Acme Engineering&rdquo; workspace with seeded projects, dates and teammates in every role.
            </p>
            <div className="mt-auto">
              <DemoButton size="md" />
            </div>
          </article>
        </div>
      </main>
    </div>
  );
}
