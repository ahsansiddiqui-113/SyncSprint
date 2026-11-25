import Link from "next/link";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChartGantt,
  Check,
  GitBranch,
  Kanban,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { DemoButton } from "@/components/auth/demo-button";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { buttonVariants } from "@/components/ui/button";
import { PriorityFlag, StatusPill, DONE_COLOR } from "@/components/ui/badge";
import { getSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { TaskPriority } from "@/db/schema";

const FEATURES = [
  { icon: Kanban, color: "#7b68ee", id: "feature-boards", title: "Boards & lists", body: "Drag work across stages on a Kanban board, or scan everything at once in a clean, grouped list." },
  { icon: CalendarDays, color: "#3f7cb8", id: "feature-calendar", title: "Calendar", body: "See what's due this month and drag tasks to a new day to reschedule in a second." },
  { icon: ChartGantt, color: "#0f9d74", id: "feature-timeline", title: "Timeline", body: "Plan start and due dates on a Gantt chart. Drag or stretch bars to adjust the plan." },
  { icon: BarChart3, color: "#dd6b00", id: "feature-dashboards", title: "Dashboards", body: "Progress, workload per person, overdue work and what got done this week, at a glance." },
  { icon: Users, color: "#e44a8a", id: "feature-collaboration", title: "Live collaboration", body: "See who's online and who's editing. Changes from teammates appear instantly — no refresh." },
  { icon: GitBranch, color: "#0891b2", id: "feature-breakdown", title: "Subtasks & checklists", body: "Break big work into subtasks and checklists, tag it, and mark what's blocking what." },
  { icon: ShieldCheck, color: "#64748b", id: "feature-roles", title: "Roles & permissions", body: "Owners, admins, members and viewers — everyone gets exactly the access they need." },
  { icon: Sparkles, color: "#8a5cf6", id: "feature-ai", title: "AI assistant", body: "Turn a big task into subtasks, get a suggested priority, and generate a daily standup." },
];

type PreviewCard = { ref: string; title: string; p: TaskPriority; who?: string; live?: string };
const PREVIEW: { title: string; color: string; cards: PreviewCard[] }[] = [
  { title: "Backlog", color: "#3f7cb8", cards: [
    { ref: "ENG-1", title: "Billing webhooks", p: "high", who: "AR" },
    { ref: "ENG-3", title: "Migrate session store", p: "low" },
  ] },
  { title: "In Progress", color: "#8a5cf6", cards: [
    { ref: "ENG-5", title: "Speed up project list", p: "urgent", who: "SC", live: "Sara editing…" },
    { ref: "ENG-6", title: "Single sign-on", p: "high", who: "AR" },
  ] },
  { title: "Review", color: "#dd6b00", cards: [{ ref: "ENG-8", title: "Access policies", p: "high", who: "SC" }] },
  { title: "Done", color: DONE_COLOR, cards: [{ ref: "ENG-12", title: "Drag-and-drop ordering", p: "medium", who: "PP" }] },
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
          {["Board", "List", "Calendar", "Timeline", "Dashboard"].map((v, i) => (
            <span key={v} className={cn("px-3 py-2", i === 0 ? "border-b-2 border-primary text-primary" : "text-muted")}>{v}</span>
          ))}
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
                      {c.live && <span className="ml-auto rounded-full bg-primary-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-primary">{c.live}</span>}
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

      <div className="absolute -bottom-8 -right-4 hidden w-96 rounded-xl border border-border bg-white p-4 text-left shadow-lift sm:block">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Activity className="h-4 w-4" /></span>
          <div>
            <p className="text-[14px] font-semibold">Alex moved ENG-6 to Review</p>
            <p className="mt-0.5 text-[13px] text-muted">and raised its priority to High · just now</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: "Plan",
    color: "#7b68ee",
    body: "Capture work as tasks, break it into subtasks and checklists, set dates and estimates. Let AI suggest priorities and split big tasks.",
    points: ["Subtasks & checklists", "Story points", "AI breakdown"],
  },
  {
    title: "Track",
    color: "#3f7cb8",
    body: "Move work across the board, reschedule on the calendar, and keep the timeline honest. Everyone sees changes the moment they happen.",
    points: ["Board, list, calendar, timeline", "Live presence", "Blocked-work alerts"],
  },
  {
    title: "Ship",
    color: "#0f9d74",
    body: "Dashboards show progress and workload. A one-click AI standup summarizes what got done, what's in flight and what's at risk.",
    points: ["Dashboards", "AI standup", "Full activity history"],
  },
];

export default async function Home() {
  const session = await getSession();
  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      <SiteHeader />

      <main className="relative mx-auto max-w-[1440px] px-8 pb-28">
        <section className="pt-20 text-center">
          <div className="mx-auto mb-7 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary-soft px-4 py-1.5 text-[14px] font-medium text-primary">
            <Sparkles className="h-4 w-4" />
            New: Workload view with capacity warnings
          </div>
          <h1 className="mx-auto max-w-5xl text-5xl font-extrabold leading-[1.05] tracking-[-0.035em] text-foreground sm:text-7xl">
            One board for your team. <span className="text-gradient">Always in sync.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[19px] leading-relaxed text-muted">
            Plan sprints, move work forward and see what your teammates are doing — live. Boards, lists, calendars,
            timelines and dashboards in one place, with an AI assistant that helps you plan.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <DemoButton />
            {!session && (
              <Link href="/sign-up" className={buttonVariants({ variant: "outline", size: "lg" })}>Create a free workspace</Link>
            )}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[15px] text-muted">
            {["No signup needed for the demo", "Ready in seconds", "Sample team included"].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-[#0f9d74]" /> {t}</span>
            ))}
          </div>
        </section>

        <BoardPreview />

        <section id="features" className="mt-36 scroll-mt-24">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="text-[14px] font-bold uppercase tracking-wider text-primary">Everything in one place</p>
            <h2 className="mt-2 text-4xl font-extrabold tracking-tight">All the views your team needs to plan, track and ship.</h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} id={f.id} className="group scroll-mt-24 rounded-2xl border border-border bg-white p-7 shadow-card transition-all hover:-translate-y-1 hover:shadow-lift">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl text-white" style={{ backgroundColor: f.color }}>
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-[19px] font-bold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="mt-36 scroll-mt-24">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="text-[14px] font-bold uppercase tracking-wider text-primary">How it works</p>
            <h2 className="mt-2 text-4xl font-extrabold tracking-tight">From idea to done, without the chaos.</h2>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="rounded-2xl border border-border bg-white p-8 shadow-card">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full text-[16px] font-bold text-white" style={{ backgroundColor: s.color }}>{i + 1}</span>
                  <h3 className="text-2xl font-extrabold tracking-tight">{s.title}</h3>
                </div>
                <p className="mt-4 text-[16px] leading-relaxed text-muted">{s.body}</p>
                <ul className="mt-5 space-y-2">
                  {s.points.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-[15px] font-medium">
                      <Check className="h-4 w-4" style={{ color: s.color }} /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section id="demo" className="mt-36 scroll-mt-24 overflow-hidden rounded-3xl bg-linear-to-br from-[#7b68ee] via-[#8e5cf0] to-[#e44a8a] px-8 py-16 text-center text-white">
          <h2 className="text-4xl font-extrabold tracking-tight">See it in 10 seconds.</h2>
          <p className="mx-auto mt-3 max-w-lg text-[17px] text-white/85">Jump into a ready-made workspace with a sample team, projects and tasks.</p>
          <div className="mt-8 flex justify-center">
            <DemoButton variant="inverse" />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
