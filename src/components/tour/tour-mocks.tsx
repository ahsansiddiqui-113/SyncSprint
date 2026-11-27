"use client";

import { createContext, useContext } from "react";
import {
  Activity, AlertTriangle, ArrowDownUp, Bell, Bookmark, BookmarkPlus, Briefcase, CalendarDays, ChartGantt, Check, ChevronRight, ChevronsUpDown,
  ClipboardList, Clock, Copy, CreditCard, FileText, Filter, Gauge, GitBranch, GitMerge, GitPullRequest, Goal, Home, Inbox, Kanban, KeyRound,
  LayoutDashboard, Link2, List as ListIcon, Lock, Mail, MessageSquare, MoreHorizontal, Network, Plug, Plus, Presentation, Rocket, Rows3, Search,
  Settings, Settings2, ShieldCheck, Smartphone, Sparkles, Table2, Timer, Users, UsersRound, Zap, CircleHelp, LayoutTemplate,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Screen } from "./tour-slides";

/* ------------------------------------------------------------------ spots */

const SpotCtx = createContext<string>("");

/** Marks a place the tour can point at; it glows when it is the current slide's spot. */
function Spot({ id, className, children, as: Tag = "div" }: { id: string; className?: string; children: React.ReactNode; as?: "div" | "span" }) {
  const active = useContext(SpotCtx) === id;
  return (
    <Tag
      data-spot={id}
      className={cn("relative rounded-lg transition-[box-shadow] duration-300", className)}
      style={active ? { animation: "tour-pulse 1.8s ease-in-out infinite", zIndex: 5 } : undefined}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ little parts */

const PEOPLE = [
  { n: "Maya Chen", c: "#7b68ee" },
  { n: "Sam Okafor", c: "#2db87d" },
  { n: "Priya Nair", c: "#e44a8a" },
  { n: "Leo Grant", c: "#ff9800" },
  { n: "Ana Ruiz", c: "#49ccf9" },
];
const STATUS = [
  { n: "To do", c: "var(--color-status-todo)" },
  { n: "In progress", c: "var(--color-status-progress)" },
  { n: "Review", c: "var(--color-status-review)" },
  { n: "Done", c: "var(--color-status-done)" },
];

function Av({ i, size = 22, ring }: { i: number; size?: number; ring?: boolean }) {
  const p = PEOPLE[i % PEOPLE.length];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", ring && "ring-2 ring-white")}
      style={{ width: size, height: size, background: p.c, fontSize: size * 0.4 }}
    >
      {p.n.split(" ").map((w) => w[0]).join("")}
    </span>
  );
}

function Btn({ children, primary, ai, className }: { children: React.ReactNode; primary?: boolean; ai?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium",
        primary ? "bg-primary text-white" : ai ? "border border-primary/30 bg-primary-soft text-primary" : "border border-border-strong bg-white",
        className
      )}
    >
      {children}
    </span>
  );
}

function Toggle({ on }: { on?: boolean }) {
  return (
    <span className={cn("relative inline-block h-5 w-9 rounded-full", on ? "bg-primary" : "bg-border-strong")}>
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow", on ? "left-[18px]" : "left-0.5")} />
    </span>
  );
}

function Panel({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-white p-4 shadow-card", className)}>
      {title && <div className="mb-3 text-[14px] font-bold">{title}</div>}
      {children}
    </div>
  );
}

function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end gap-3">
      <div>
        <h2 className="text-[24px] font-extrabold tracking-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-[13.5px] text-muted">{sub}</p>}
      </div>
      <div className="ml-auto flex gap-2">{right}</div>
    </div>
  );
}

function Bar({ pct, color = "var(--color-primary)" }: { pct: number; color?: string }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

/* ------------------------------------------------------------------ frame */

export const STAGE_W = 1280;
export const STAGE_H = 760;

/** A browser window around the app, so the address shows where each page lives. */
export function TourStage({ screen, spot, url }: { screen: Screen; spot: string; url: string }) {
  return (
    <SpotCtx.Provider value={spot}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-white text-foreground" style={{ width: STAGE_W, height: STAGE_H }}>
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-surface-2 px-4">
          <span className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </span>
          <span className="mx-auto flex h-7 w-[520px] items-center gap-2 rounded-md bg-white px-3 text-[12.5px] text-muted shadow-card">
            <Lock className="h-3 w-3" /> syncsprint.app<span className="text-foreground">{url}</span>
          </span>
        </div>
        <div key={screen} className="flex min-h-0 flex-1 animate-fade-up">
          <ScreenBody screen={screen} />
        </div>
      </div>
    </SpotCtx.Provider>
  );
}

function ScreenBody({ screen }: { screen: Screen }) {
  switch (screen) {
    case "signup": return <SignUp />;
    case "workspaces": return <Workspaces />;
    case "account": case "accountSecurity": case "notifications": case "calendarFeed": return <AccountShell screen={screen} />;
    case "guest": return <AppShell guest active="WEB"><GuestBoard /></AppShell>;
    default: return <AppShell active={activeNav(screen)}><Main screen={screen} /></AppShell>;
  }
}

function activeNav(screen: Screen): string {
  const map: Partial<Record<Screen, string>> = {
    home: "Home", palette: "Home", newProject: "Home", inbox: "Inbox", docs: "Docs", portfolio: "Portfolio", goals: "Goals", groups: "Groups", activity: "Activity",
    members: "Members", billing: "Billing & plan", share: "Share links", integrations: "Integrations", security: "Security",
  };
  return map[screen] ?? "ENG";
}

/* ------------------------------------------------------------------ sidebar */

const NAV = [
  { l: "Home", i: Home }, { l: "Inbox", i: Inbox, b: 3 }, { l: "Docs", i: FileText }, { l: "Portfolio", i: Briefcase },
  { l: "Goals", i: Goal }, { l: "Groups", i: UsersRound }, { l: "Activity", i: Activity },
];
const SETTINGS = [
  { l: "Members", i: Users }, { l: "Billing & plan", i: CreditCard }, { l: "Share links", i: Link2 }, { l: "Integrations", i: Plug }, { l: "Security", i: Lock },
];
const SPACES = [
  { k: "ENG", n: "Engineering", c: "#7b68ee", t: 42 },
  { k: "MKT", n: "Marketing launch", c: "#ff9800", t: 18 },
  { k: "WEB", n: "Client website", c: "#2db87d", t: 23 },
  { k: "OPS", n: "Operations", c: "#e44a8a", t: 9 },
];

function AppShell({ children, active, guest }: { children: React.ReactNode; active: string; guest?: boolean }) {
  const row = (on: boolean) => cn("flex items-center gap-2.5 rounded-lg px-2.5 py-[3px] text-[13px] font-medium", on ? "bg-primary-soft text-primary" : "text-muted");
  return (
    <>
      <aside className="flex w-[232px] shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar">
        <div className="border-b border-border p-2.5">
          <Spot id="switcher" className="flex items-center gap-2.5 px-2 py-1.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-[#8930fd] to-[#49ccf9] text-[14px] font-bold text-white">A</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">Acme Studio</span>
              <span className="block text-[12px] text-subtle">{guest ? "Guest" : "Workspace"}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 text-subtle" />
          </Spot>
        </div>
        {!guest && (
          <div className="mx-2.5 mt-2 flex items-center gap-2 rounded-lg bg-primary-soft px-2.5 py-1 text-[12px] font-medium text-primary">
            <Timer className="h-3.5 w-3.5" /> ENG-12 · 0:42:10
          </div>
        )}
        {!guest && (
          <div className="px-2.5 pt-2">
            <Spot id="search" className="flex items-center gap-2 border border-border bg-white px-2.5 py-1 text-[13px] text-subtle">
              <Search className="h-3.5 w-3.5" /> <span className="flex-1">Search…</span>
              <kbd className="rounded border border-border px-1 text-[10px]">Ctrl K</kbd>
            </Spot>
          </div>
        )}
        <Spot id="nav" className="mx-2.5 mt-2 space-y-px">
          {guest ? (
            <div className={row(false)}><Home className="h-4 w-4" /> Shared with you</div>
          ) : (
            NAV.map((n) => (
              <div key={n.l} className={row(active === n.l)}>
                <n.i className="h-4 w-4" /> <span className="flex-1">{n.l}</span>
                {n.b && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white">{n.b}</span>}
              </div>
            ))
          )}
        </Spot>
        {!guest && (
          <Spot id="settings" className="mx-2.5 mt-2 space-y-px">
            <div className="px-2.5 pb-0.5 text-[12px] font-semibold text-subtle">Workspace</div>
            {SETTINGS.map((n) => (
              <div key={n.l} className={row(active === n.l)}><n.i className="h-4 w-4" /> {n.l}</div>
            ))}
          </Spot>
        )}
        <Spot id="spaces" className="mx-2.5 mt-2 min-h-0 flex-1">
          <div className="flex items-center justify-between px-2.5 pb-0.5 text-[12px] font-semibold text-subtle">
            Spaces {!guest && <Plus className="h-3.5 w-3.5" />}
          </div>
          {(guest ? SPACES.filter((s) => s.k === "WEB") : SPACES).map((s) => (
            <div key={s.k} className={cn("flex items-center gap-2.5 rounded-lg px-2.5 py-[3px] text-[13px]", active === s.k && "bg-primary-soft font-semibold text-primary")}>
              <span className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold text-white" style={{ background: s.c }}>{s.n[0]}</span>
              <span className="flex-1 truncate">{s.n}</span>
              <span className="text-[12px] text-subtle">{s.t}</span>
            </div>
          ))}
        </Spot>
        <div className="border-t border-border p-2.5">
          {!guest && (
            <Spot id="help" className="mb-1.5 flex items-center gap-2 px-2.5 py-1 text-[13px] font-medium text-muted">
              <CircleHelp className="h-4 w-4" /> How it works
            </Spot>
          )}
          <Spot id="me" className="flex items-center gap-2 px-1.5 py-1">
            <Av i={guest ? 4 : 0} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{guest ? "Ana Ruiz" : "Maya Chen"}</span>
              <span className="block text-[11.5px] text-subtle">{guest ? "Guest" : "Admin"}</span>
            </span>
            <Settings className="h-4 w-4 text-subtle" />
          </Spot>
        </div>
      </aside>
      <div className="relative min-w-0 flex-1 overflow-hidden bg-canvas">{children}</div>
    </>
  );
}

/* ------------------------------------------------------------------ main area router */

const PROJECT_VIEWS: Partial<Record<Screen, string>> = {
  board: "board", boardWip: "board", boardLanes: "board", boardFilters: "board", boardLive: "board", drawer: "board",
  automations: "board", forms: "board", email: "board", more: "board", customize: "board",
  list: "list", table: "table", sprints: "sprints", calendar: "calendar", timeline: "timeline", workload: "workload", dashboard: "dashboard", whiteboards: "whiteboards",
};

function Main({ screen }: { screen: Screen }) {
  if (PROJECT_VIEWS[screen]) return <Project screen={screen} view={PROJECT_VIEWS[screen]!} />;
  switch (screen) {
    case "home": return <HomePage />;
    case "palette": return <><HomePage /><Palette /></>;
    case "newProject": return <><HomePage /><NewProject /></>;
    case "inbox": return <InboxPage />;
    case "docs": return <DocsPage />;
    case "goals": return <GoalsPage />;
    case "portfolio": return <PortfolioPage />;
    case "groups": return <GroupsPage />;
    case "activity": return <ActivityPage />;
    case "members": return <MembersPage />;
    case "integrations": return <IntegrationsPage />;
    case "share": return <SharePage />;
    case "security": return <SecurityPage />;
    case "billing": return <BillingPage />;
    default: return null;
  }
}

/* ------------------------------------------------------------------ auth + workspaces */

function SignUp() {
  return (
    <div className="flex flex-1 items-center justify-center bg-linear-to-br from-primary-soft via-white to-[#e9f9ff]">
      <div className="w-[420px] rounded-2xl border border-border bg-white p-8 shadow-lift">
        <div className="text-center text-[24px] font-extrabold tracking-tight">Create your account</div>
        <p className="mt-1 text-center text-[13.5px] text-muted">Free for 14 days. No card needed.</p>
        <Spot id="oauth" className="mt-6 space-y-2">
          <div className="flex h-10 items-center justify-center gap-2 rounded-lg border border-border-strong text-[14px] font-medium"><span className="font-bold text-[#4285f4]">G</span> Continue with Google</div>
          <div className="flex h-10 items-center justify-center gap-2 rounded-lg border border-border-strong text-[14px] font-medium"><span className="grid h-4 w-4 grid-cols-2 gap-px"><i className="bg-[#f25022]" /><i className="bg-[#7fba00]" /><i className="bg-[#00a4ef]" /><i className="bg-[#ffb900]" /></span> Continue with Microsoft</div>
        </Spot>
        <Spot id="sso" className="mt-2 flex h-10 items-center justify-center gap-2 rounded-lg border border-border-strong text-[14px] font-medium"><KeyRound className="h-4 w-4" /> Sign in with company SSO</Spot>
        <div className="my-4 flex items-center gap-3 text-[12px] text-subtle"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
        <Spot id="email" className="space-y-2">
          {["Your name", "Work email", "Password"].map((p) => <div key={p} className="h-10 rounded-lg border border-border px-3 text-[13.5px] leading-10 text-subtle">{p}</div>)}
          <div className="flex h-10 items-center justify-center rounded-lg bg-primary text-[14px] font-semibold text-white">Create account</div>
        </Spot>
      </div>
    </div>
  );
}

function Workspaces() {
  return (
    <div className="flex-1 bg-canvas px-16 py-10">
      <PageTitle title="Your workspaces" sub="Pick one to open, or start a new one for your company." />
      <div className="grid grid-cols-3 gap-4">
        {[{ n: "Acme Studio", r: "Admin · 12 people" }, { n: "Freelance clients", r: "Member · 4 people" }].map((w, i) => (
          <Panel key={w.n}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg text-[16px] font-bold text-white" style={{ background: i ? "#2db87d" : "#7b68ee" }}>{w.n[0]}</span>
              <div><div className="text-[15px] font-bold">{w.n}</div><div className="text-[12.5px] text-subtle">{w.r}</div></div>
            </div>
          </Panel>
        ))}
        <Spot id="create-ws" className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary-soft/50 p-4 text-[15px] font-semibold text-primary">
          <Plus className="h-5 w-5" /> Create workspace
        </Spot>
      </div>
      <Panel className="mt-6 max-w-xl" title="New workspace">
        <div className="space-y-2">
          <div className="h-10 rounded-lg border border-primary px-3 text-[14px] leading-10">Acme Studio</div>
          <div className="text-[12.5px] text-subtle">Address: syncsprint.app/w/<b className="text-foreground">acme</b></div>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ home + overlays */

function HomePage() {
  return (
    <div className="h-full overflow-hidden px-8 py-6">
      <PageTitle title="Good morning, Maya" sub="Here's what's happening in Acme Studio." right={<Spot id="new-project" as="span"><Btn primary><Plus className="h-4 w-4" /> New project</Btn></Spot>} />
      <Spot id="checklist" className="mb-5 rounded-xl border border-primary/25 bg-white p-4 shadow-card">
        <div className="flex items-center gap-2 text-[14px] font-bold"><Sparkles className="h-4 w-4 text-primary" /> Getting started <span className="ml-auto text-[12.5px] font-medium text-subtle">3 of 6 done</span></div>
        <div className="mt-2"><Bar pct={50} /></div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
          {[["Create a project", 1], ["Add your first task", 1], ["Invite your team", 1], ["Try the Board view", 0], ["Connect Slack or Teams", 0], ["Turn on two-step sign-in", 0]].map(([t, d]) => (
            <div key={t as string} className="flex items-center gap-2">
              <span className={cn("flex h-4 w-4 items-center justify-center rounded-full border", d ? "border-status-done bg-status-done text-white" : "border-border-strong")}>{d ? <Check className="h-3 w-3" /> : null}</span>
              <span className={d ? "text-subtle line-through" : ""}>{t}</span>
            </div>
          ))}
        </div>
      </Spot>
      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <Panel title="Projects">
          <div className="grid grid-cols-2 gap-3">
            {SPACES.map((s, i) => (
              <div key={s.k} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2 text-[13.5px] font-semibold"><span className="h-3 w-3 rounded" style={{ background: s.c }} />{s.n}</div>
                <div className="mt-2"><Bar pct={[62, 35, 80, 20][i]} color={s.c} /></div>
                <div className="mt-1.5 text-[12px] text-subtle">{s.t} tasks · {[62, 35, 80, 20][i]}% done</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="My work">
          {["ENG-12 Checkout page redesign", "ENG-19 Fix login on Safari", "MKT-4 Launch email draft", "WEB-7 Homepage review"].map((t, i) => (
            <div key={t} className="flex items-center gap-2 border-b border-border py-2 text-[13px] last:border-0">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS[i % 3].c }} />
              <span className="flex-1 truncate">{t}</span>
              <span className={cn("text-[12px]", i === 1 ? "font-semibold text-rose-600" : "text-subtle")}>{["Today", "Overdue", "Fri", "Mon"][i]}</span>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Overlay({ children, align = "center" }: { children: React.ReactNode; align?: "center" | "top" | "right" }) {
  return (
    <div className={cn("absolute inset-0 z-10 flex bg-[#16171d]/30", align === "center" && "items-center justify-center", align === "top" && "justify-center pt-16", align === "right" && "justify-end")}>
      {children}
    </div>
  );
}

function Palette() {
  return (
    <Overlay align="top">
      <Spot id="palette" className="h-fit w-[560px] overflow-hidden rounded-xl border border-border bg-white shadow-lift">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[15px]"><Search className="h-4 w-4 text-subtle" /> check<span className="animate-pulse">|</span></div>
        <div className="p-2 text-[13.5px]">
          <div className="px-2 py-1 text-[11.5px] font-semibold uppercase text-subtle">Tasks</div>
          <div className="flex items-center gap-2 rounded-lg bg-primary-soft px-2 py-2 text-primary"><Kanban className="h-4 w-4" /> <b>ENG-12</b> Checkout page redesign <span className="ml-auto text-[11.5px]">Enter ↵</span></div>
          <div className="flex items-center gap-2 px-2 py-2"><Kanban className="h-4 w-4 text-subtle" /> <b>ENG-31</b> Checkout error states</div>
          <div className="px-2 py-1 text-[11.5px] font-semibold uppercase text-subtle">Docs</div>
          <div className="flex items-center gap-2 px-2 py-2"><FileText className="h-4 w-4 text-subtle" /> Checkout v2 spec</div>
          <div className="px-2 py-1 text-[11.5px] font-semibold uppercase text-subtle">Pages</div>
          <div className="flex items-center gap-2 px-2 py-2"><CreditCard className="h-4 w-4 text-subtle" /> Billing & plan</div>
        </div>
      </Spot>
    </Overlay>
  );
}

function NewProject() {
  const t = [
    { n: "Blank", d: "Start empty", c: "#8f949c" }, { n: "Scrum", d: "Sprints, story points", c: "#7b68ee" }, { n: "Bug tracking", d: "Triage to fixed", c: "#e44a8a" },
    { n: "Marketing campaign", d: "Plan, create, launch", c: "#ff9800" }, { n: "Client onboarding", d: "Kick-off to live", c: "#2db87d" }, { n: "Product roadmap", d: "Now, next, later", c: "#49ccf9" },
  ];
  return (
    <Overlay>
      <div className="w-[640px] rounded-2xl border border-border bg-white p-6 shadow-lift">
        <div className="text-[18px] font-bold">New project</div>
        <div className="mt-3 grid grid-cols-[1fr_120px] gap-3">
          <div className="h-10 rounded-lg border border-primary px-3 text-[14px] leading-10">Mobile app</div>
          <div className="h-10 rounded-lg border border-border px-3 text-[14px] leading-10 text-muted">Key: APP</div>
        </div>
        <div className="mt-4 text-[13px] font-semibold text-muted">Template</div>
        <Spot id="template" className="mt-2 grid grid-cols-3 gap-2 p-0.5">
          {t.map((x, i) => (
            <div key={x.n} className={cn("rounded-lg border p-3", i === 1 ? "border-primary bg-primary-soft" : "border-border")}>
              <div className="flex items-center gap-2 text-[13.5px] font-semibold"><LayoutTemplate className="h-4 w-4" style={{ color: x.c }} />{x.n}</div>
              <div className="mt-0.5 text-[12px] text-subtle">{x.d}</div>
            </div>
          ))}
        </Spot>
        <div className="mt-5 flex justify-end gap-2"><Btn>Cancel</Btn><Btn primary>Create project</Btn></div>
      </div>
    </Overlay>
  );
}

/* ------------------------------------------------------------------ project */

const VIEW_TABS = [
  { id: "board", l: "Board", i: Kanban }, { id: "list", l: "List", i: ListIcon }, { id: "table", l: "Table", i: Table2 }, { id: "sprints", l: "Sprints", i: Rocket },
  { id: "calendar", l: "Calendar", i: CalendarDays }, { id: "timeline", l: "Timeline", i: ChartGantt }, { id: "workload", l: "Workload", i: Gauge },
  { id: "dashboard", l: "Dashboard", i: LayoutDashboard }, { id: "whiteboards", l: "Whiteboards", i: Presentation },
];

function Project({ screen, view }: { screen: Screen; view: string }) {
  return (
    <div className="flex h-full flex-col bg-white">
      <header className="border-b border-border px-6 pt-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-[12px] font-bold text-white">EN</span>
          <div>
            <div className="flex items-center gap-1 text-[12px] text-subtle">Acme Studio <ChevronRight className="h-3 w-3" /> Projects <ChevronRight className="h-3 w-3" /> ENG</div>
            <div className="flex items-center gap-2 text-[19px] font-bold leading-tight">Engineering <Spot id="live" as="span" className="flex items-center gap-1 px-1 text-[11.5px] font-medium text-status-done"><span className="h-2 w-2 rounded-full bg-status-done" /> Live</Spot></div>
          </div>
          <Spot id="toolbar" className="ml-auto flex items-center gap-1.5 p-0.5">
            <Spot id="presence" as="span" className="mr-1 flex -space-x-1.5 px-0.5">{[1, 2, 3].map((i) => <Av key={i} i={i} ring />)}</Spot>
            <Btn><Settings2 className="h-3.5 w-3.5" /> Customize</Btn>
            <Spot id="automate" as="span"><Btn><Zap className="h-3.5 w-3.5" /> Automate</Btn></Spot>
            <Spot id="more" as="span"><Btn><MoreHorizontal className="h-3.5 w-3.5" /></Btn></Spot>
            <Btn ai><Sparkles className="h-3.5 w-3.5" /> AI standup</Btn>
            <Btn><LayoutTemplate className="h-3.5 w-3.5" /> Templates</Btn>
            <Btn primary><Plus className="h-3.5 w-3.5" /> Add Task</Btn>
          </Spot>
        </div>
        <Spot id="views" className="mt-2 flex w-fit gap-0.5">
          {VIEW_TABS.map((v) => (
            <span key={v.id} className={cn("flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-[13.5px] font-medium", view === v.id ? "border-primary text-primary" : "border-transparent text-muted")}>
              <v.i className="h-3.5 w-3.5" /> {v.l}
            </span>
          ))}
        </Spot>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-canvas">
        {view === "board" && <BoardView screen={screen} />}
        {view === "list" && <ListView />}
        {view === "table" && <TableView />}
        {view === "sprints" && <SprintsView />}
        {view === "calendar" && <CalendarView />}
        {view === "timeline" && <TimelineView />}
        {view === "workload" && <WorkloadView />}
        {view === "dashboard" && <DashboardView />}
        {view === "whiteboards" && <WhiteboardView />}
        {screen === "drawer" && <TaskDrawer />}
        {screen === "automations" && <AutomationsPanel />}
        {screen === "forms" && <FormsPanel />}
        {screen === "email" && <EmailPanel />}
        {screen === "customize" && <CustomizePanel />}
        {screen === "more" && <MoreMenu />}
      </div>
    </div>
  );
}

const CARDS: Record<number, { k: string; t: string; p: number; a: number; tag?: string; pr?: string }[]> = {
  0: [{ k: "ENG-21", t: "Password reset email", p: 1, a: 3, tag: "auth" }, { k: "ENG-24", t: "Dark mode tokens", p: 2, a: 1 }, { k: "ENG-27", t: "Export invoices to CSV", p: 2, a: 4, tag: "billing" }],
  1: [{ k: "ENG-12", t: "Checkout page redesign", p: 0, a: 0, tag: "ui" }, { k: "ENG-19", t: "Fix login on Safari", p: 0, a: 2, tag: "bug" }, { k: "ENG-22", t: "Rate-limit the API", p: 1, a: 1 }],
  2: [{ k: "ENG-15", t: "Onboarding tooltips", p: 2, a: 3, pr: "#142" }],
  3: [{ k: "ENG-9", t: "Upgrade to Postgres 17", p: 1, a: 1 }, { k: "ENG-11", t: "Audit log page", p: 2, a: 0 }],
};
const PRIO = [{ l: "Urgent", c: "#e5484d" }, { l: "High", c: "#f5a623" }, { l: "Normal", c: "#3f7cb8" }];

function Card({ c, spot }: { c: (typeof CARDS)[0][0]; spot?: boolean }) {
  const inner = (
    <div className="rounded-lg border border-border bg-white p-2.5 shadow-card">
      <div className="flex items-center gap-1.5 text-[11.5px] text-subtle">{c.k}{c.tag && <span className="rounded bg-surface-2 px-1.5 text-[11px] text-muted">{c.tag}</span>}{c.pr && <span className="ml-auto flex items-center gap-0.5 text-[11px] text-status-done"><GitPullRequest className="h-3 w-3" />{c.pr}</span>}</div>
      <div className="mt-1 text-[13px] font-medium leading-snug">{c.t}</div>
      <div className="mt-2 flex items-center gap-2 text-[11.5px]">
        <span className="flex items-center gap-1" style={{ color: PRIO[c.p].c }}><span className="h-2 w-2 rounded-full" style={{ background: PRIO[c.p].c }} />{PRIO[c.p].l}</span>
        <span className="ml-auto"><Av i={c.a} size={20} /></span>
      </div>
    </div>
  );
  return spot ? <Spot id="card">{inner}</Spot> : inner;
}

function WipBadge({ n, limit }: { n: number; limit: number }) {
  const over = n > limit, at = n === limit;
  return <span className={cn("rounded-md px-1.5 text-[11.5px] font-semibold", over ? "bg-rose-100 text-rose-700" : at ? "bg-amber-100 text-amber-700" : "bg-surface-2 text-muted")}>{n}/{limit}</span>;
}

function BoardView({ screen }: { screen: Screen }) {
  const lanes = screen === "boardLanes";
  const wip = screen === "boardWip" || lanes;
  return (
    <div className="flex h-full flex-col px-5 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <Spot id="filters" className="flex items-center gap-2 p-0.5">
          <Btn><Filter className="h-3.5 w-3.5" /> Filter {screen === "boardFilters" && <span className="rounded bg-primary px-1.5 text-[11px] text-white">2</span>}</Btn>
          {screen === "boardFilters" && <><span className="rounded-full border border-primary/40 bg-primary-soft px-2.5 py-1 text-[12px] text-primary">Assignee: Maya ×</span><span className="rounded-full border border-primary/40 bg-primary-soft px-2.5 py-1 text-[12px] text-primary">Priority: Urgent, High ×</span></>}
          <Btn><ArrowDownUp className="h-3.5 w-3.5" /> Sort</Btn>
          <Btn><Bookmark className="h-3.5 w-3.5" /> {screen === "boardFilters" ? "Save view…" : "Views"}</Btn>
        </Spot>
        <Spot id="lanes" className="ml-auto flex items-center gap-2 p-0.5 text-[12.5px] text-muted">
          <Rows3 className="h-4 w-4" /> Swimlanes
          <span className="flex rounded-lg border border-border bg-white p-0.5">
            {["None", "Assignee", "Priority", "Type"].map((l) => <span key={l} className={cn("rounded-md px-2 py-0.5", (lanes ? l === "Assignee" : l === "None") && "bg-primary-soft font-semibold text-primary")}>{l}</span>)}
          </span>
        </Spot>
      </div>
      {!lanes ? (
        <div className="grid min-h-0 flex-1 grid-cols-4 gap-3">
          {STATUS.map((s, i) => (
            <div key={s.n} className="flex flex-col rounded-xl bg-surface-2/70 p-2">
              <div className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.c }} />{s.n}
                <span className="ml-auto">{wip && i === 1 ? <Spot id="wip" as="span" className="px-0.5"><WipBadge n={4} limit={3} /></Spot> : wip && i === 2 ? <WipBadge n={1} limit={2} /> : <span className="text-[12px] text-subtle">{CARDS[i].length}</span>}</span>
              </div>
              <div className="space-y-2">
                {CARDS[i].map((c) => <Card key={c.k} c={c} spot={c.k === "ENG-12"} />)}
                {wip && i === 1 && <Card c={{ k: "ENG-30", t: "Webhook retries", p: 1, a: 4 }} />}
                {screen === "boardLive" && i === 2 && (
                  <div className="relative rounded-lg border-2 border-dashed border-[#2db87d] bg-white/60 p-2.5 text-[12px] text-muted">
                    <span className="absolute -top-2.5 left-2 rounded bg-[#2db87d] px-1.5 text-[11px] font-semibold text-white">Sam is moving ENG-22</span>
                    Rate-limit the API
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-white">
          <div className="grid grid-cols-[150px_repeat(4,1fr)] border-b border-border bg-surface-2 text-[12.5px] font-semibold">
            <div className="p-2" />
            {STATUS.map((s, i) => <div key={s.n} className="flex items-center gap-1.5 p-2"><span className="h-2 w-2 rounded-full" style={{ background: s.c }} />{s.n}{i === 1 && <span className="ml-auto"><WipBadge n={3} limit={3} /></span>}</div>)}
          </div>
          {[0, 1, 2].map((p) => (
            <div key={p} className="grid grid-cols-[150px_repeat(4,1fr)] border-b border-border last:border-0">
              <div className="flex items-center gap-2 p-2 text-[13px] font-semibold"><Av i={p} /> {PEOPLE[p].n.split(" ")[0]}</div>
              {[0, 1, 2, 3].map((s) => (
                <div key={s} className="space-y-1.5 border-l border-border p-1.5">
                  {Object.values(CARDS)[s].filter((c) => c.a === p).slice(0, 1).map((c) => <Card key={c.k} c={c} spot={c.k === "ENG-12"} />)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ListView() {
  return (
    <div className="h-full px-6 pt-4">
      <Spot id="list" className="space-y-3 p-0.5">
        {STATUS.slice(0, 3).map((s, i) => (
          <div key={s.n} className="rounded-xl border border-border bg-white">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[13px] font-semibold"><span className="rounded-md px-2 py-0.5 text-white" style={{ background: s.c }}>{s.n}</span><span className="text-subtle">{CARDS[i].length}</span></div>
            {CARDS[i].map((c) => (
              <div key={c.k} className="grid grid-cols-[70px_1fr_110px_90px_80px] items-center border-b border-border px-3 py-2 text-[13px] last:border-0">
                <span className="text-subtle">{c.k}</span><span className="font-medium">{c.t}</span>
                <span className="flex items-center gap-1.5"><Av i={c.a} size={18} />{PEOPLE[c.a].n.split(" ")[0]}</span>
                <span style={{ color: PRIO[c.p].c }}>{PRIO[c.p].l}</span><span className="text-subtle">Dec {4 + i * 3}</span>
              </div>
            ))}
          </div>
        ))}
      </Spot>
    </div>
  );
}

function TableView() {
  const cols = ["Key", "Name", "Status", "Assignee", "Priority", "Points", "Due", "Client"];
  const rows = Object.values(CARDS).flatMap((cs, s) => cs.map((c) => ({ ...c, s })));
  return (
    <div className="h-full px-6 pt-4">
      <Spot id="table" className="overflow-hidden border border-border bg-white">
        <div className="grid grid-cols-[70px_1.6fr_110px_120px_90px_60px_70px_110px] bg-surface-2 text-[12px] font-semibold text-muted">
          {cols.map((c) => <div key={c} className="border-r border-border px-2.5 py-2 last:border-0">{c}{c === "Priority" && " ↓"}</div>)}
        </div>
        {rows.map((r, i) => (
          <div key={r.k} className="grid grid-cols-[70px_1.6fr_110px_120px_90px_60px_70px_110px] border-t border-border text-[12.5px]">
            <div className="px-2.5 py-1.5 text-subtle">{r.k}</div>
            <div className={cn("px-2.5 py-1.5 font-medium", i === 3 && "bg-primary-soft ring-1 ring-primary ring-inset")}>{r.t}</div>
            <div className="px-2.5 py-1.5"><span className="rounded px-1.5 text-[11.5px] text-white" style={{ background: STATUS[r.s].c }}>{STATUS[r.s].n}</span></div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5"><Av i={r.a} size={18} />{PEOPLE[r.a].n.split(" ")[0]}</div>
            <div className="px-2.5 py-1.5" style={{ color: PRIO[r.p].c }}>{PRIO[r.p].l}</div>
            <div className="px-2.5 py-1.5">{[3, 5, 2, 8, 1][i % 5]}</div>
            <div className="px-2.5 py-1.5 text-subtle">Dec {3 + i}</div>
            <div className="px-2.5 py-1.5 text-muted">{["Northwind", "Contoso", "—", "Fabrikam"][i % 4]}</div>
          </div>
        ))}
      </Spot>
    </div>
  );
}

function SprintsView() {
  return (
    <div className="grid h-full grid-cols-[1fr_340px] gap-4 px-6 pt-4">
      <div className="space-y-3">
        <Panel>
          <div className="flex items-center gap-2 text-[14px] font-bold"><Rocket className="h-4 w-4 text-primary" /> Sprint 14 <span className="rounded-full bg-status-done/15 px-2 text-[11.5px] font-semibold text-status-done">Active</span><span className="ml-auto text-[12px] font-normal text-subtle">Nov 24 – Dec 5 · 34 pts</span></div>
          {CARDS[1].concat(CARDS[2]).map((c) => (
            <div key={c.k} className="mt-2 flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-[13px]"><span className="text-subtle">{c.k}</span>{c.t}<span className="ml-auto"><Av i={c.a} size={18} /></span></div>
          ))}
        </Panel>
        <Panel>
          <div className="text-[14px] font-bold">Backlog <span className="font-normal text-subtle">· 12</span></div>
          {CARDS[0].map((c) => <div key={c.k} className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5 text-[13px] text-muted"><span>{c.k}</span>{c.t}</div>)}
        </Panel>
      </div>
      <div className="space-y-3">
        <Spot id="capacity" className="rounded-xl border border-border bg-white p-4 shadow-card">
          <div className="mb-2 text-[14px] font-bold">Capacity</div>
          {[[0, 28, 32], [1, 36, 30], [2, 18, 24], [3, 12, 16]].map(([p, h, cap]) => (
            <div key={p} className="mb-2 text-[12.5px]">
              <div className="mb-1 flex items-center gap-2"><Av i={p} size={18} />{PEOPLE[p].n.split(" ")[0]}<span className={cn("ml-auto", h > cap && "font-semibold text-rose-600")}>{h}h / {cap}h</span></div>
              <Bar pct={Math.min(100, (h / cap) * 100)} color={h > cap ? "#e5484d" : "var(--color-primary)"} />
            </div>
          ))}
          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-rose-600"><AlertTriangle className="h-3.5 w-3.5" /> Sam is over by 6h (1 day off)</div>
        </Spot>
        <Panel title="Burndown">
          <svg viewBox="0 0 300 120" className="w-full">
            <line x1="10" y1="10" x2="290" y2="110" stroke="#d5d9df" strokeDasharray="4 4" />
            <polyline points="10,10 50,22 90,30 130,52 170,58 210,74" fill="none" stroke="#7b68ee" strokeWidth="3" />
          </svg>
        </Panel>
      </div>
    </div>
  );
}

function CalendarView() {
  const chips: Record<number, [string, number][]> = { 3: [["ENG-21 Password reset", 0]], 5: [["ENG-12 Checkout", 1]], 9: [["ENG-19 Safari login", 1], ["ENG-24 Dark mode", 0]], 12: [["ENG-15 Tooltips", 2]], 17: [["ENG-27 CSV export", 0]], 23: [["Release 2.4", 3]] };
  return (
    <div className="h-full px-6 pt-4">
      <div className="mb-2 flex items-center gap-2 text-[15px] font-bold">December 2026 <span className="ml-auto flex gap-1"><Btn>Today</Btn><Btn>‹</Btn><Btn>›</Btn></span></div>
      <Spot id="cal" className="grid grid-cols-7 overflow-hidden border border-border bg-white">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="border-b border-border bg-surface-2 px-2 py-1 text-[12px] font-semibold text-muted">{d}</div>)}
        {Array.from({ length: 35 }, (_, i) => (
          <div key={i} className={cn("h-[86px] border-b border-r border-border p-1 text-[11.5px]", (i % 7) > 4 && "bg-surface-2/50")}>
            <div className={cn("mb-0.5 text-subtle", i === 2 && "font-bold text-primary")}>{i < 31 ? i + 1 : ""}</div>
            {chips[i]?.map(([t, s]) => <div key={t} className="mb-0.5 truncate rounded px-1 py-px text-white" style={{ background: STATUS[s].c }}>{t}</div>)}
          </div>
        ))}
      </Spot>
    </div>
  );
}

function TimelineView() {
  const rows = [
    { t: "Design checkout", s: 0, w: 4, b: [0, 4], crit: true },
    { t: "Build payment API", s: 4, w: 5, b: [3, 4], crit: true },
    { t: "Checkout page UI", s: 5, w: 4, b: [5, 3] },
    { t: "QA and fixes", s: 9, w: 3, b: [7, 3], crit: true },
    { t: "Docs and release notes", s: 8, w: 3, b: [8, 3] },
    { t: "Launch", s: 12, w: 1, b: [10, 1], crit: true, ms: true },
  ];
  const cw = 54;
  return (
    <div className="h-full px-6 pt-4">
      <div className="mb-2 flex items-center gap-2"><Btn><Bookmark className="h-3.5 w-3.5" /> Baseline: Nov plan</Btn><Btn className="border-rose-300 text-rose-600"><Network className="h-3.5 w-3.5" /> Critical path</Btn><span className="ml-auto text-[12px] text-subtle">Grey = baseline · Red = can&apos;t slip</span></div>
      <div className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="grid grid-cols-[200px_1fr] border-b border-border bg-surface-2 text-[12px] font-semibold text-muted">
          <div className="px-3 py-2">Task</div>
          <div className="flex">{Array.from({ length: 14 }, (_, i) => <div key={i} className="border-l border-border py-2 text-center" style={{ width: cw }}>Dec {i + 1}</div>)}</div>
        </div>
        <Spot id="critical" className="relative">
          {rows.map((r) => (
            <div key={r.t} className="grid h-12 grid-cols-[200px_1fr] border-b border-border last:border-0">
              <div className="flex items-center px-3 text-[13px] font-medium">{r.t}</div>
              <div className="relative">
                <span className="absolute top-[30px] h-2 rounded-full bg-border-strong" style={{ left: r.b[0] * cw, width: r.b[1] * cw }} />
                {r.ms ? (
                  <span className="absolute top-2.5 h-5 w-5 rotate-45 bg-rose-500" style={{ left: r.s * cw + 14 }} />
                ) : (
                  <span className={cn("absolute top-2 flex h-6 items-center rounded-md px-2 text-[11.5px] font-medium text-white", r.crit ? "bg-rose-500" : "bg-primary")} style={{ left: r.s * cw, width: r.w * cw - 6 }}>{r.w}d</span>
                )}
              </div>
            </div>
          ))}
          <svg className="pointer-events-none absolute left-[200px] top-0" width={14 * cw} height={288}>
            {[[4, 0, 4, 1], [9, 1, 9, 3], [12, 3, 12, 5]].map(([x1, r1, x2, r2], i) => (
              <path key={i} d={`M${x1 * cw - 6} ${r1 * 48 + 20} h10 V${r2 * 48 + 20} h4`} fill="none" stroke="#e5484d" strokeWidth="1.5" markerEnd="url(#ah)" />
            ))}
            <defs><marker id="ah" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L6 3 L0 6z" fill="#e5484d" /></marker></defs>
          </svg>
        </Spot>
      </div>
    </div>
  );
}

function WorkloadView() {
  const heat = (h: number) => (h > 40 ? "#e5484d" : h > 32 ? "#f5a623" : h > 16 ? "#a99ef5" : "#e4e0fc");
  const data = [[38, 44, 30, 22], [20, 26, 36, 41], [30, 18, 12, 24], [8, 14, 22, 20], [36, 32, 28, 16]];
  return (
    <div className="h-full px-6 pt-4">
      <Spot id="workload" className="overflow-hidden border border-border bg-white">
        <div className="grid grid-cols-[200px_repeat(4,1fr)] bg-surface-2 text-[12px] font-semibold text-muted">
          <div className="px-3 py-2">Person</div>{["Nov 30", "Dec 7", "Dec 14", "Dec 21"].map((w) => <div key={w} className="px-3 py-2">Week of {w}</div>)}
        </div>
        {data.map((row, p) => (
          <div key={p} className="grid grid-cols-[200px_repeat(4,1fr)] border-t border-border">
            <div className="flex items-center gap-2 px-3 py-3 text-[13px] font-medium"><Av i={p} /> {PEOPLE[p].n}</div>
            {row.map((h, i) => <div key={i} className="p-1.5"><div className="flex h-10 items-center justify-center rounded-lg text-[13px] font-semibold" style={{ background: heat(h), color: h > 32 ? "#fff" : "#292d34" }}>{h}h</div></div>)}
          </div>
        ))}
      </Spot>
      <div className="mt-3 flex items-center gap-3 text-[12px] text-muted">{[["Light", "#e4e0fc"], ["Busy", "#a99ef5"], ["Full", "#f5a623"], ["Overloaded", "#e5484d"]].map(([l, c]) => <span key={l} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ background: c }} />{l}</span>)}</div>
    </div>
  );
}

function DashboardView() {
  const layers = [
    { c: "var(--color-status-done)", y: [200, 185, 170, 150, 128, 105, 85] },
    { c: "var(--color-status-review)", y: [210, 198, 186, 170, 152, 135, 118] },
    { c: "var(--color-status-progress)", y: [222, 214, 204, 192, 178, 166, 155] },
    { c: "var(--color-status-todo)", y: [232, 228, 222, 214, 206, 200, 195] },
  ];
  const area = (top: number[], bottom: number[]) => `M${top.map((y, i) => `${i * 90},${y}`).join(" L")} L${[...bottom].reverse().map((y, i) => `${(bottom.length - 1 - i) * 90},${y}`).join(" L")} Z`;
  const base = [240, 240, 240, 240, 240, 240, 240];
  return (
    <div className="h-full px-6 pt-4">
      <div className="mb-3 grid grid-cols-4 gap-3">
        {[["Open tasks", "27"], ["Done this week", "14"], ["Cycle time (85%)", "4.2 days"], ["Overdue", "3"]].map(([l, v], i) => (
          <Panel key={l}><div className="text-[12px] text-subtle">{l}</div><div className={cn("mt-1 text-[24px] font-extrabold", i === 3 && "text-rose-600")}>{v}</div></Panel>
        ))}
      </div>
      <div className="grid grid-cols-[1.5fr_1fr] gap-3">
        <Spot id="flow" className="rounded-xl border border-border bg-white p-4 shadow-card">
          <div className="mb-2 text-[14px] font-bold">Cumulative flow</div>
          <svg viewBox="0 0 540 250" className="w-full">
            {layers.map((l, i) => <path key={i} d={area(l.y, i === layers.length - 1 ? base : layers[i + 1].y)} fill={l.c} opacity={0.85} />)}
            <path d={area(layers[0].y, layers[0].y.map(() => 40))} fill="none" />
          </svg>
        </Spot>
        <Panel title="Cycle time">
          <svg viewBox="0 0 300 250" className="w-full">
            <line x1="0" y1="150" x2="300" y2="150" stroke="#7b68ee" strokeDasharray="5 4" /><text x="4" y="144" fontSize="11" fill="#7b68ee">50%</text>
            <line x1="0" y1="80" x2="300" y2="80" stroke="#e5484d" strokeDasharray="5 4" /><text x="4" y="74" fontSize="11" fill="#e5484d">85%</text>
            {[[30, 180], [60, 160], [80, 120], [110, 200], [140, 90], [160, 170], [190, 140], [220, 60], [240, 175], [270, 130], [100, 150], [205, 185]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="5" fill="#7b68ee" opacity="0.7" />)}
          </svg>
        </Panel>
      </div>
    </div>
  );
}

function WhiteboardView() {
  const notes = [
    { t: "Faster checkout", x: 80, y: 60, c: "#fff3b0" }, { t: "Apple Pay", x: 260, y: 40, c: "#ffd6e7" }, { t: "Save card", x: 300, y: 170, c: "#d6f5e3" },
    { t: "Guest checkout", x: 110, y: 220, c: "#dbeafe" },
  ];
  return (
    <div className="h-full p-4">
      <Spot id="canvas" className="relative h-full overflow-hidden border border-border bg-white" >
        <div className="absolute inset-0" style={{ backgroundImage: "radial-gradient(#d5d9df 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
        <div className="absolute left-3 top-3 flex gap-1 rounded-lg border border-border bg-white p-1 shadow-card text-[12px]">{["Select", "Sticky", "Shape", "Text", "Connector", "Mind map"].map((t, i) => <span key={t} className={cn("rounded px-2 py-1", i === 1 && "bg-primary-soft font-semibold text-primary")}>{t}</span>)}</div>
        {notes.map((n, i) => (
          <div key={n.t} className="absolute w-36 rounded-md p-3 text-[13px] font-medium shadow-lift" style={{ left: n.x, top: n.y + 40, background: n.c, transform: `rotate(${[-2, 2, -1, 1][i]}deg)` }}>
            {n.t}
            {i === 0 && <span className="mt-2 flex w-fit items-center gap-1 rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold text-primary"><Plus className="h-3 w-3" /> Make task</span>}
          </div>
        ))}
        <svg className="absolute left-[520px] top-[70px]" width="440" height="360">
          {[[60, 180, 220, 60], [60, 180, 220, 180], [60, 180, 220, 300]].map(([a, b, c, d], i) => <path key={i} d={`M${a + 60} ${b} C ${a + 120} ${b}, ${c - 60} ${d}, ${c} ${d}`} fill="none" stroke="#a99ef5" strokeWidth="2" />)}
        </svg>
        <div className="absolute left-[540px] top-[230px] rounded-full bg-primary px-4 py-2 text-[13px] font-bold text-white">Q1 launch</div>
        {["Website", "Email campaign", "Partner demo"].map((t, i) => <div key={t} className="absolute rounded-full border-2 border-primary/50 bg-white px-3 py-1.5 text-[12.5px] font-medium" style={{ left: 740, top: 110 + i * 120 }}>{t}</div>)}
      </Spot>
    </div>
  );
}

/* ------------------------------------------------------------------ project side panels */

function SidePanel({ title, children, width = 400 }: { title: string; children: React.ReactNode; width?: number }) {
  return (
    <div className="absolute inset-y-0 right-0 z-10 flex animate-slide-in flex-col border-l border-border bg-white shadow-lift" style={{ width }}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[15px] font-bold">{title}<span className="ml-auto text-subtle">×</span></div>
      <div data-scroll className="min-h-0 flex-1 overflow-hidden p-4">{children}</div>
    </div>
  );
}

function Section({ title, icon: Icon, children, id }: { title: string; icon: typeof Check; children: React.ReactNode; id: string }) {
  return (
    <Spot id={id} className="mb-3 border border-border p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><Icon className="h-4 w-4 text-subtle" /> {title}</div>
      {children}
    </Spot>
  );
}

function TaskDrawer() {
  return (
    <SidePanel title="ENG-12 · Checkout page redesign" width={460}>
      <Spot id="fields" className="mb-3 grid grid-cols-[90px_1fr] gap-y-1.5 p-2 text-[12.5px]">
        {[["Status", <span key="s" className="rounded px-1.5 text-white" style={{ background: STATUS[1].c }}>In progress</span>], ["Assignee", <span key="a" className="flex items-center gap-1.5"><Av i={0} size={18} /> Maya Chen</span>], ["Sprint", "Sprint 14"], ["Dates", "Nov 28 → Dec 5"], ["Estimate", "16h · 5 pts"], ["Priority", <span key="p" style={{ color: PRIO[0].c }}>Urgent</span>], ["Client", "Northwind"]].map(([l, v]) => (
          <div key={l as string} className="contents"><span className="text-subtle">{l}</span><span>{v}</span></div>
        ))}
      </Spot>
      <Section id="subtasks" title="Break into subtasks · 2/4" icon={ClipboardList}>
        <Bar pct={50} color="var(--color-status-done)" />
        {[["Wireframes", 1], ["Payment form", 1], ["Error states", 0], ["Mobile layout", 0]].map(([t, d]) => <div key={t as string} className="mt-1.5 flex items-center gap-2 text-[12.5px]"><span className={cn("flex h-3.5 w-3.5 items-center justify-center rounded border", d ? "border-status-done bg-status-done text-white" : "border-border-strong")}>{d ? <Check className="h-2.5 w-2.5" /> : null}</span><span className={d ? "text-subtle line-through" : ""}>{t}</span></div>)}
      </Section>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Section id="timer" title="Time" icon={Clock}><div className="flex items-center gap-2 text-[12.5px]"><span className="rounded-md bg-primary px-2 py-0.5 font-semibold text-white">■ 0:42:10</span><span className="text-subtle">6h logged</span></div></Section>
        <Section id="remind" title="Remind me" icon={Bell}><div className="flex flex-wrap gap-1 text-[11.5px]">{["Later today", "Tomorrow", "Pick a date"].map((t, i) => <span key={t} className={cn("rounded border px-1.5 py-0.5", i === 1 ? "border-primary bg-primary-soft text-primary" : "border-border")}>{t}</span>)}</div></Section>
      </div>
      <Section id="dev" title="Development" icon={GitBranch}>
        <div className="space-y-1 text-[12px]">
          <div className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5 text-subtle" /> feature/ENG-12-checkout</div>
          <div className="flex items-center gap-1.5"><GitPullRequest className="h-3.5 w-3.5 text-status-done" /> #142 Checkout redesign <span className="ml-auto rounded bg-status-done/15 px-1.5 text-status-done">open</span></div>
          <div className="flex items-center gap-1.5"><GitMerge className="h-3.5 w-3.5 text-primary" /> 3 commits · acme/web</div>
        </div>
      </Section>
      <Section id="comments" title="Comments" icon={MessageSquare}>
        <div className="flex gap-2 text-[12.5px]"><Av i={1} size={22} /><div className="rounded-lg bg-surface-2 px-2.5 py-1.5"><b>Sam</b> Looks great! <span className="font-semibold text-primary">@Priya</span> can you check the copy?</div></div>
        <div className="mt-2 h-8 rounded-lg border border-border px-2.5 text-[12.5px] leading-8 text-subtle">Write a comment… type @ to mention</div>
      </Section>
    </SidePanel>
  );
}

function AutomationsPanel() {
  return (
    <SidePanel title="Automations" width={480}>
      <Spot id="rule" className="border border-primary/40 bg-primary-soft/40 p-3 text-[13px]">
        <div className="text-[12px] font-semibold uppercase text-primary">When</div>
        <div className="mt-1 rounded-lg border border-border bg-white px-3 py-2">Status changes to <b>Review</b></div>
        <div className="mt-2 text-[12px] font-semibold uppercase text-primary">If</div>
        <div className="mt-1 rounded-lg border border-border bg-white px-3 py-2">Priority is <b>Urgent</b> or <b>High</b></div>
        <div className="mt-2 text-[12px] font-semibold uppercase text-primary">Then</div>
        <div className="mt-1 space-y-1">
          <div className="rounded-lg border border-border bg-white px-3 py-2">Assign to <b>Sam Okafor</b></div>
          <div className="rounded-lg border border-border bg-white px-3 py-2">Post in <b>Slack #eng-reviews</b></div>
        </div>
      </Spot>
      <div className="mt-3 space-y-2 text-[13px]">
        {[["Every Monday 9:00", "Create \"Weekly planning\" task"], ["Due date passes", "Notify the assignee"]].map(([w, t]) => (
          <div key={w} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"><Zap className="h-4 w-4 text-primary" /><span className="flex-1"><b>{w}</b> → {t}</span><Toggle on /></div>
        ))}
      </div>
    </SidePanel>
  );
}

function MoreMenu() {
  const items = [[ClipboardList, "Forms (public intake)"], [Mail, "Email to task"], [ArrowDownUp, "Import & export CSV"], [Link2, "Share read-only link"], [BookmarkPlus, "Save project as template"]] as const;
  return (
    <Spot id="more-menu" className="absolute right-[330px] top-1 z-10 w-64 border border-border bg-white p-1.5 shadow-lift">
      {items.map(([I, l]) => <div key={l} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px]"><I className="h-4 w-4 text-subtle" /> {l}</div>)}
    </Spot>
  );
}

function FormsPanel() {
  return (
    <SidePanel title="Forms" width={480}>
      <div className="rounded-lg border border-border p-3">
        <div className="text-[14px] font-bold">Report a bug</div>
        <div className="mt-2 space-y-1.5 text-[12.5px]">{["What happened? (title)", "Steps to reproduce", "Browser", "Your email"].map((f) => <div key={f} className="rounded-md bg-surface-2 px-2.5 py-1.5">{f}</div>)}</div>
        <div className="mt-2 text-[12px] text-muted">New tasks go to <b>To do</b>, assigned to <b>Sam</b>, tagged <b>bug</b>.</div>
      </div>
      <Spot id="form-link" className="mt-3 flex items-center gap-2 border border-primary/40 bg-primary-soft/40 px-3 py-2 text-[12.5px]">
        <Link2 className="h-4 w-4 text-primary" /> syncsprint.app/f/8kq2…x7 <span className="ml-auto"><Btn><Copy className="h-3.5 w-3.5" /> Copy</Btn></span>
      </Spot>
      <div className="mt-3 text-[12.5px] text-muted">14 responses · last one 2 hours ago</div>
    </SidePanel>
  );
}

function EmailPanel() {
  return (
    <SidePanel title="Email to task" width={480}>
      <p className="text-[13px] text-muted">Forward or send an email to this address. The subject becomes the title, the body the description.</p>
      <Spot id="email-addr" className="mt-3 flex items-center gap-2 border border-primary/40 bg-primary-soft/40 px-3 py-2.5 text-[13px] font-medium">
        <Mail className="h-4 w-4 text-primary" /> eng-4f7a@in.syncsprint.app <span className="ml-auto"><Btn><Copy className="h-3.5 w-3.5" /> Copy</Btn></span>
      </Spot>
      <div className="mt-3 rounded-lg border border-border p-3 text-[12.5px]">
        <div className="text-subtle">From: priya@acme.com</div>
        <div className="font-semibold">Fwd: Customer can&apos;t download invoice</div>
        <div className="mt-2 flex items-center gap-1.5 text-status-done"><Check className="h-3.5 w-3.5" /> Became ENG-33 in To do</div>
      </div>
    </SidePanel>
  );
}

function CustomizePanel() {
  return (
    <SidePanel title="Customize project" width={480}>
      <div className="text-[13px] font-semibold text-muted">Statuses</div>
      <div className="mt-2 space-y-1.5">
        {STATUS.map((s, i) => <div key={s.n} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[13px]"><span className="text-subtle">⋮⋮</span><span className="h-3 w-3 rounded-full" style={{ background: s.c }} />{s.n}<span className="ml-auto text-[12px] text-subtle">WIP {[["—", "3", "2", "—"][i]]}</span></div>)}
      </div>
      <Spot id="custom-fields" className="mt-4 border border-border p-3">
        <div className="text-[13px] font-semibold text-muted">Custom fields</div>
        {[["Client", "Dropdown"], ["Budget", "Money"], ["Story type", "Labels"], ["Launch date", "Date"]].map(([n, t]) => <div key={n} className="mt-1.5 flex items-center rounded-md bg-surface-2 px-2.5 py-1.5 text-[13px]">{n}<span className="ml-auto text-[12px] text-subtle">{t}</span></div>)}
        <div className="mt-2 text-[13px] font-semibold text-primary">+ Add field</div>
      </Spot>
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ workspace pages */

function Page({ children }: { children: React.ReactNode }) {
  return <div className="h-full overflow-hidden px-8 py-6">{children}</div>;
}

function InboxPage() {
  const items = [
    [MessageSquare, "Sam mentioned you in ENG-12", "\"@Maya can you review the copy?\"", "2m", 1],
    [Bell, "Reminder: Fix login on Safari", "You asked to be reminded today", "1h", 1],
    [ClipboardList, "New form response in Engineering", "Report a bug → ENG-34", "3h", 1],
    [GitMerge, "Pull request #139 merged", "ENG-9 moved to Done", "Yesterday", 0],
    [Users, "Priya assigned you MKT-4", "Launch email draft", "Yesterday", 0],
  ] as const;
  return (
    <Page>
      <PageTitle title="Inbox" sub="Everything that needs your attention." right={<Btn>Mark all as read</Btn>} />
      <Spot id="inbox" className="overflow-hidden border border-border bg-white">
        {items.map(([I, t, d, w, u]) => (
          <div key={t} className={cn("flex items-center gap-3 border-b border-border px-4 py-3 last:border-0", u && "bg-primary-soft/40")}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2"><I className="h-4 w-4 text-primary" /></span>
            <div className="flex-1"><div className={cn("text-[14px]", u ? "font-semibold" : "")}>{t}</div><div className="text-[12.5px] text-muted">{d}</div></div>
            <span className="text-[12px] text-subtle">{w}</span>{u ? <span className="h-2 w-2 rounded-full bg-primary" /> : <span className="w-2" />}
          </div>
        ))}
      </Spot>
    </Page>
  );
}

function DocsPage() {
  return (
    <div className="grid h-full grid-cols-[240px_1fr]">
      <div className="border-r border-border bg-white p-3 text-[13.5px]">
        <div className="mb-2 flex items-center justify-between font-bold">Docs <Plus className="h-4 w-4" /></div>
        {["Checkout v2 spec", "Weekly sync notes", "Onboarding guide", "Release checklist"].map((d, i) => <div key={d} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5", i === 0 && "bg-primary-soft font-semibold text-primary")}><FileText className="h-4 w-4" />{d}</div>)}
      </div>
      <Spot id="doc" className="m-5 overflow-hidden rounded-xl border border-border bg-white p-8">
        <div className="text-[26px] font-extrabold tracking-tight">Checkout v2 spec</div>
        <div className="mt-1 flex items-center gap-2 text-[12px] text-subtle"><Av i={0} size={18} /> Maya · edited 5 min ago</div>
        <div className="mt-5 text-[16px] font-bold">Goal</div>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">Cut checkout drop-off by a third by removing steps and adding Apple Pay and saved cards.</p>
        <div className="mt-4 text-[16px] font-bold">Work</div>
        <div className="mt-2 space-y-1.5">
          {[["ENG-12", "Checkout page redesign", 1], ["ENG-22", "Rate-limit the API", 1], ["ENG-31", "Checkout error states", 0]].map(([k, t, s]) => <div key={k as string} className="flex w-fit items-center gap-2 rounded-lg border border-border px-2.5 py-1 text-[13px]"><span className="h-2 w-2 rounded-full" style={{ background: STATUS[s as number].c }} /><b className="text-subtle">{k}</b> {t}</div>)}
        </div>
      </Spot>
    </div>
  );
}

function GoalsPage() {
  return (
    <Page>
      <PageTitle title="Goals" sub="Q4 2026" right={<Btn primary><Plus className="h-4 w-4" /> New goal</Btn>} />
      <div className="grid grid-cols-2 gap-4">
        <Spot id="goal" className="rounded-xl border border-border bg-white p-4 shadow-card">
          <div className="flex items-center gap-2 text-[15px] font-bold"><Goal className="h-4 w-4 text-primary" /> Launch checkout v2 <span className="ml-auto text-[13px] text-primary">68%</span></div>
          <div className="mt-2"><Bar pct={68} /></div>
          {[["Ship redesign (5 linked tasks)", 80], ["Drop-off below 30%", 55], ["Apple Pay live", 70]].map(([k, p]) => <div key={k as string} className="mt-3 text-[13px]"><div className="mb-1 flex">{k}<span className="ml-auto text-subtle">{p}%</span></div><Bar pct={p as number} color="#2db87d" /></div>)}
        </Spot>
        {[["Grow newsletter to 10k", 42, "#ff9800"], ["Hire 3 engineers", 33, "#e44a8a"], ["SOC 2 ready", 75, "#49ccf9"]].map(([t, p, c]) => (
          <Panel key={t as string}><div className="flex text-[15px] font-bold">{t}<span className="ml-auto text-[13px]" style={{ color: c as string }}>{p}%</span></div><div className="mt-2"><Bar pct={p as number} color={c as string} /></div></Panel>
        ))}
      </div>
    </Page>
  );
}

function PortfolioPage() {
  return (
    <Page>
      <PageTitle title="Portfolio" sub="Every project at a glance." />
      <Spot id="portfolio" className="overflow-hidden border border-border bg-white">
        <div className="grid grid-cols-[1.4fr_1fr_110px_90px_110px_90px] bg-surface-2 px-4 py-2 text-[12px] font-semibold text-muted"><span>Project</span><span>Progress</span><span>Health</span><span>Overdue</span><span>Due</span><span>Lead</span></div>
        {SPACES.map((s, i) => (
          <div key={s.k} className="grid grid-cols-[1.4fr_1fr_110px_90px_110px_90px] items-center border-t border-border px-4 py-3 text-[13px]">
            <span className="flex items-center gap-2 font-semibold"><span className="h-3 w-3 rounded" style={{ background: s.c }} />{s.n}</span>
            <span className="pr-6"><Bar pct={[62, 35, 80, 20][i]} color={s.c} /></span>
            <span><span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", ["bg-status-done/15 text-status-done", "bg-amber-100 text-amber-700", "bg-status-done/15 text-status-done", "bg-rose-100 text-rose-700"][i])}>{["On track", "At risk", "On track", "Off track"][i]}</span></span>
            <span className={i === 3 ? "font-semibold text-rose-600" : ""}>{[1, 2, 0, 4][i]}</span>
            <span className="text-muted">{["Dec 12", "Jan 9", "Dec 5", "Nov 30"][i]}</span>
            <span><Av i={i} /></span>
          </div>
        ))}
      </Spot>
    </Page>
  );
}

function GroupsPage() {
  return (
    <Page>
      <PageTitle title="Groups" right={<Btn primary><Plus className="h-4 w-4" /> New group</Btn>} />
      <div className="grid grid-cols-3 gap-4">
        {[["Design", [0, 2], 7], ["Engineering", [1, 3, 0], 21], ["Support", [4, 2], 5]].map(([n, ps, o], i) => {
          const body = (
            <>
              <div className="text-[15px] font-bold">{n as string}</div>
              <div className="mt-2 flex -space-x-1.5">{(ps as number[]).map((p) => <Av key={p} i={p} ring />)}</div>
              <div className="mt-3 text-[12.5px] text-muted">{o as number} open tasks · 2 unclaimed</div>
              <div className="mt-2"><Bar pct={[55, 82, 40][i]} color={["#7b68ee", "#f5a623", "#2db87d"][i]} /></div>
              <div className="mt-1 text-[11.5px] text-subtle">Workload this week</div>
            </>
          );
          return i === 0 ? <Spot key={n as string} id="group" className="rounded-xl border border-border bg-white p-4 shadow-card">{body}</Spot> : <Panel key={n as string}>{body}</Panel>;
        })}
      </div>
    </Page>
  );
}

function ActivityPage() {
  const rows = [
    [0, "moved ENG-12 to In progress", "Engineering", "2m"], [1, "commented on ENG-19", "Engineering", "15m"], [2, "created the doc Checkout v2 spec", "Docs", "1h"],
    [3, "changed the due date of MKT-4 to Dec 9", "Marketing launch", "2h"], [0, "invited ana@client.com as a guest", "Members", "3h"], [4, "commented on WEB-7", "Client website", "Yesterday"],
  ] as const;
  return (
    <Page>
      <PageTitle title="Activity" sub="Who changed what, and when." right={<><Btn><Filter className="h-3.5 w-3.5" /> Person</Btn><Btn><Filter className="h-3.5 w-3.5" /> Project</Btn></>} />
      <Spot id="activity" className="overflow-hidden border border-border bg-white">
        {rows.map(([p, t, w, when], i) => <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-[13.5px] last:border-0"><Av i={p} /><span><b>{PEOPLE[p].n.split(" ")[0]}</b> {t}</span><span className="ml-auto text-[12px] text-subtle">{w} · {when}</span></div>)}
      </Spot>
    </Page>
  );
}

function MembersPage() {
  return (
    <Page>
      <PageTitle title="Members" sub="12 people · 1 guest" />
      <Spot id="invite" className="mb-4 flex items-center gap-2 border border-border bg-white p-3">
        <div className="h-9 flex-1 rounded-lg border border-border px-3 text-[13.5px] leading-9 text-muted">leo@acme.com, ana@client.com</div>
        <span className="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-[13.5px]">Member <ChevronsUpDown className="h-3.5 w-3.5" /></span>
        <Btn primary>Send invites</Btn>
      </Spot>
      <div className="overflow-hidden rounded-xl border border-border bg-white">
        {PEOPLE.map((p, i) => (
          <div key={p.n} className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-[13.5px] last:border-0">
            <Av i={i} /><span className="font-medium">{p.n}</span><span className="text-subtle">{p.n.split(" ")[0].toLowerCase()}@{i === 4 ? "client.com" : "acme.com"}</span>
            <span className={cn("ml-auto rounded-full px-2.5 py-0.5 text-[12px] font-semibold", ["bg-primary-soft text-primary", "bg-surface-2", "bg-surface-2", "bg-sky-100 text-sky-700", "bg-amber-100 text-amber-700"][i])}>{["Admin", "Member", "Member", "Viewer", "Guest"][i]}</span>
          </div>
        ))}
      </div>
    </Page>
  );
}

function GuestBoard() {
  return (
    <div className="h-full px-6 py-5">
      <div className="mb-1 text-[12px] text-subtle">Shared with you by Acme Studio</div>
      <div className="mb-3 flex items-center gap-2 text-[20px] font-bold">Client website <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-medium text-muted">Read only · can comment</span></div>
      <Spot id="guest-board" className="grid grid-cols-4 gap-3 p-0.5">
        {STATUS.map((s, i) => (
          <div key={s.n} className="rounded-xl bg-surface-2/70 p-2">
            <div className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.c }} />{s.n}</div>
            {[["Homepage copy", "Pricing page"], ["Contact form"], ["Logo update"], ["Kick-off call", "Sitemap"]][i].map((t) => (
              <div key={t} className="mb-2 rounded-lg border border-border bg-white p-2.5 text-[13px] font-medium shadow-card">{t}{t === "Logo update" && <div className="mt-1.5 flex items-center gap-1 text-[11.5px] text-muted"><MessageSquare className="h-3 w-3" /> 2 comments</div>}</div>
            ))}
          </div>
        ))}
      </Spot>
    </div>
  );
}

function IntegrationsPage() {
  return (
    <Page>
      <PageTitle title="Integrations" sub="Connect the tools your team already uses." />
      <div className="grid grid-cols-2 gap-4">
        <Spot id="chat" className="rounded-xl border border-border bg-white p-4 shadow-card">
          <div className="mb-3 text-[14px] font-bold">Chat alerts</div>
          {[["Slack", "#eng-updates · Engineering", "#4a154b"], ["Microsoft Teams", "Product channel · all projects", "#5059c9"], ["Discord", "Not connected", "#5865f2"], ["Google Chat", "Not connected", "#34a853"]].map(([n, d, c], i) => (
            <div key={n} className="flex items-center gap-3 border-b border-border py-2 text-[13px] last:border-0"><span className="flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-bold text-white" style={{ background: c }}>{n[0]}</span><div className="flex-1"><div className="font-semibold">{n}</div><div className="text-[12px] text-subtle">{d}</div></div>{i < 2 ? <Toggle on /> : <Btn>Connect</Btn>}</div>
          ))}
        </Spot>
        <Spot id="repos" className="rounded-xl border border-border bg-white p-4 shadow-card">
          <div className="mb-3 text-[14px] font-bold">Code</div>
          {[["GitHub", "acme/web → Engineering"], ["GitLab", "Not connected"]].map(([n, d], i) => (
            <div key={n} className="flex items-center gap-3 border-b border-border py-2 text-[13px] last:border-0"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#24292f] text-[12px] font-bold text-white">{n[0]}</span><div className="flex-1"><div className="font-semibold">{n}</div><div className="text-[12px] text-subtle">{d}</div></div>{i === 0 ? <span className="text-[12px] font-semibold text-status-done">Connected</span> : <Btn>Connect</Btn>}</div>
          ))}
          <div className="mt-4 mb-2 text-[14px] font-bold">For developers</div>
          <div className="flex gap-2"><Btn><KeyRound className="h-3.5 w-3.5" /> API keys</Btn><Btn><Plug className="h-3.5 w-3.5" /> Webhooks</Btn></div>
        </Spot>
      </div>
    </Page>
  );
}

function SharePage() {
  return (
    <Page>
      <PageTitle title="Share links" sub="Read-only views for people outside the workspace." />
      <Spot id="share" className="overflow-hidden border border-border bg-white">
        {[["Client website", "Expires Dec 31", true], ["Marketing launch", "Never expires", true], ["Engineering", "Turned off", false]].map(([n, e, on]) => (
          <div key={n as string} className="flex items-center gap-3 border-b border-border px-4 py-3 text-[13.5px] last:border-0"><Link2 className="h-4 w-4 text-primary" /><span className="font-semibold">{n}</span><span className="text-subtle">syncsprint.app/s/…</span><span className="ml-auto text-[12.5px] text-muted">{e}</span><Toggle on={on as boolean} /></div>
        ))}
      </Spot>
    </Page>
  );
}

function SecurityPage() {
  return (
    <Page>
      <PageTitle title="Security" sub="Who can get in, and how." />
      <div className="grid grid-cols-2 gap-4">
        <Spot id="require2fa" className="rounded-xl border border-border bg-white p-4 shadow-card">
          <div className="flex items-center gap-2 text-[14px] font-bold"><Smartphone className="h-4 w-4 text-primary" /> Require two-step sign-in <span className="ml-auto"><Toggle on /></span></div>
          <p className="mt-1 text-[12.5px] text-muted">Everyone must use an authenticator app before they can open this workspace.</p>
        </Spot>
        <Panel>
          <div className="flex items-center gap-2 text-[14px] font-bold"><KeyRound className="h-4 w-4 text-primary" /> Single sign-on <span className="ml-auto rounded-full bg-status-done/15 px-2 text-[11.5px] font-semibold text-status-done">Verified</span></div>
          <p className="mt-1 text-[12.5px] text-muted">Okta (OIDC) · acme.com · SSO required for this domain</p>
        </Panel>
        <Panel>
          <div className="flex items-center gap-2 text-[14px] font-bold"><Network className="h-4 w-4 text-primary" /> Allowed networks</div>
          <div className="mt-2 rounded-md bg-surface-2 px-2.5 py-1.5 font-mono text-[12px]">203.0.113.0/24<br />2001:db8::/32</div>
        </Panel>
        <Panel>
          <div className="flex items-center gap-2 text-[14px] font-bold"><Users className="h-4 w-4 text-primary" /> SCIM provisioning <span className="ml-auto"><Toggle on /></span></div>
          <p className="mt-1 text-[12.5px] text-muted">People added or removed in your identity provider are added or removed here.</p>
        </Panel>
        <Panel className="col-span-2">
          <div className="flex items-center gap-2 text-[14px] font-bold"><ShieldCheck className="h-4 w-4 text-primary" /> Audit log <span className="ml-auto flex gap-2"><Btn>Keep 1 year</Btn><Btn>Export CSV</Btn><Btn>Export workspace</Btn></span></div>
        </Panel>
      </div>
    </Page>
  );
}

function BillingPage() {
  const plans = [["Pay as you go", "$5", "per person / month", "Monthly, cancel anytime"], ["Team", "$3.50", "per person / month", "1–50 people, billed yearly"], ["Business", "$3", "per person / month", "51–100 people, billed yearly"]];
  return (
    <Page>
      <PageTitle title="Billing & plan" sub="Free trial · 9 days left" />
      <Spot id="plans" className="grid grid-cols-3 gap-4 p-0.5">
        {plans.map(([n, p, u, d], i) => (
          <div key={n} className={cn("rounded-xl border bg-white p-5 shadow-card", i === 1 ? "border-primary ring-1 ring-primary" : "border-border")}>
            {i === 1 && <div className="mb-2 w-fit rounded-full bg-primary-soft px-2 py-0.5 text-[11.5px] font-semibold text-primary">Suggested for 12 people</div>}
            <div className="text-[16px] font-bold">{n}</div>
            <div className="mt-2 text-[30px] font-extrabold">{p}<span className="text-[13px] font-medium text-subtle"> {u}</span></div>
            <div className="mt-1 text-[12.5px] text-muted">{d}</div>
            <div className={cn("mt-4 flex h-9 items-center justify-center rounded-lg text-[13.5px] font-semibold", i === 1 ? "bg-primary text-white" : "border border-border-strong")}>Choose {n}</div>
          </div>
        ))}
      </Spot>
      <p className="mt-4 text-[13px] text-muted">Guests are always free. Prices are per person, never below the plan&apos;s minimum.</p>
    </Page>
  );
}

/* ------------------------------------------------------------------ account */

function AccountShell({ screen }: { screen: Screen }) {
  const items = [["Sign-in & security", ShieldCheck, "accountSecurity"], ["Notifications", Bell, "notifications"], ["Calendar feed", CalendarDays, "calendarFeed"]] as const;
  const current = screen === "account" ? "accountSecurity" : screen;
  return (
    <div className="flex flex-1 flex-col bg-canvas">
      <div className="flex h-12 items-center gap-4 border-b border-border bg-white px-6 text-[13.5px]"><span className="font-bold">SyncSprint</span><span className="text-muted">← Your workspaces</span></div>
      <div className="flex flex-1 gap-8 px-8 py-6">
        <Spot id="account-nav" className="h-fit w-56 p-1">
          <div className="mb-2 px-3 text-[11.5px] font-semibold uppercase text-subtle">Your account</div>
          {items.map(([l, I, s]) => <div key={l} className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] font-medium", current === s ? "bg-primary-soft text-primary" : "text-muted")}><I className="h-4 w-4" />{l}</div>)}
        </Spot>
        <div className="flex-1">
          {current === "accountSecurity" && <AccountSecurity />}
          {current === "notifications" && <NotificationsPage />}
          {current === "calendarFeed" && <CalendarFeedPage />}
        </div>
      </div>
    </div>
  );
}

function AccountSecurity() {
  return (
    <div className="space-y-4">
      <Spot id="twofa" className="rounded-xl border border-border bg-white p-5 shadow-card">
        <div className="flex items-center gap-2 text-[16px] font-bold"><Smartphone className="h-5 w-5 text-primary" /> Two-step sign-in <span className="rounded-full bg-status-done/15 px-2 text-[11.5px] font-semibold text-status-done">On</span></div>
        <p className="mt-1 text-[13px] text-muted">After your password we ask for a code from your authenticator app.</p>
        <div className="mt-3 flex items-end gap-3"><div><div className="mb-1.5 text-[12.5px] font-medium">Confirm your password</div><div className="h-9 w-64 rounded-lg border border-border" /></div><Btn>Make new backup codes</Btn><Btn className="border-rose-200 bg-rose-50 text-rose-600">Turn off</Btn></div>
      </Spot>
      <Panel title="Linked sign-in"><div className="flex gap-2 text-[13px]"><Btn>Google · linked</Btn><Btn>Microsoft · link</Btn></div></Panel>
      <Spot id="devices" className="rounded-xl border border-border bg-white p-5 shadow-card">
        <div className="flex items-center text-[16px] font-bold">Where you&apos;re signed in <span className="ml-auto"><Btn>Sign out other devices</Btn></span></div>
        {[["Chrome on Windows", "This device", true], ["Safari on iPhone", "London · 2 hours ago", false]].map(([d, w, me]) => <div key={d as string} className="mt-2 flex items-center gap-2 text-[13px]"><span className="font-medium">{d}</span><span className="text-subtle">{w}</span>{me && <span className="rounded-full bg-primary-soft px-2 text-[11px] font-semibold text-primary">You</span>}</div>)}
      </Spot>
    </div>
  );
}

function NotificationsPage() {
  return (
    <div className="space-y-4">
      <Spot id="channels" className="rounded-xl border border-border bg-white p-5 shadow-card">
        <div className="text-[16px] font-bold">Acme Studio</div>
        {[["Push on this device", "Pop-ups even when SyncSprint is closed", true], ["Instant email", "One email per mention or assignment", true], ["Digest", "Daily at 8:00", true], ["WhatsApp", "Not set up", false]].map(([t, d, on]) => (
          <div key={t as string} className="flex items-center gap-3 border-b border-border py-3 last:border-0"><div className="flex-1"><div className="text-[14px] font-semibold">{t}</div><div className="text-[12.5px] text-muted">{d}</div></div><Toggle on={on as boolean} /></div>
        ))}
      </Spot>
    </div>
  );
}

function CalendarFeedPage() {
  return (
    <Spot id="ics" className="rounded-xl border border-border bg-white p-5 shadow-card">
      <div className="flex items-center gap-2 text-[16px] font-bold"><CalendarDays className="h-5 w-5 text-primary" /> Your calendar feed</div>
      <p className="mt-1 text-[13px] text-muted">Due dates and time off from every workspace, in the calendar you already use. Keep the link private.</p>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12.5px]">https://syncsprint.app/api/calendar/••••••••.ics <span className="ml-auto"><Btn><Copy className="h-3.5 w-3.5" /> Copy</Btn></span></div>
      <div className="mt-3 flex gap-2 text-[13px]"><Btn>Add to Google Calendar</Btn><Btn>Outlook</Btn><Btn>Apple Calendar</Btn><Btn className="text-rose-600">Make a new link</Btn></div>
    </Spot>
  );
}
