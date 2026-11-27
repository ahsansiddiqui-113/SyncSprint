// TEMPORARY: renders the LinkedIn carousel slides for screenshots. Delete after export.
import { Logo } from "@/components/ui/card";
import { TourStage } from "@/components/tour/tour-mocks";
import type { Screen } from "@/components/tour/tour-slides";

type S = { kicker: string; title: string; sub: string; screen?: Screen; spot?: string; url?: string; play?: boolean; cta?: boolean };

const SLIDES: S[] = [
  { kicker: "Build in public", title: "I built a full SaaS from scratch.", sub: "Meet SyncSprint: plan, track and ship work, all in one place.", screen: "board", spot: "", url: "/w/acme/projects/ENG" },
  { kicker: "Boards", title: "Drag. Drop. Done.", sub: "Live boards with WIP limits and swimlanes. Everyone sees changes instantly.", screen: "boardLanes", spot: "lanes", url: "/w/acme/projects/ENG" },
  { kicker: "Tasks", title: "Everything about a task, in one place.", sub: "Subtasks, time tracking, reminders, GitHub links and @mentions.", screen: "drawer", spot: "", url: "/w/acme/projects/ENG?task=ENG-12" },
  { kicker: "Timeline", title: "Gantt + critical path.", sub: "Dependencies, baselines, and the work that can't slip shown in red.", screen: "timeline", spot: "critical", url: "/w/acme/projects/ENG?view=timeline" },
  { kicker: "Sprints", title: "Sprints that respect people's time.", sub: "Capacity per person, time off included, with a live burndown.", screen: "sprints", spot: "capacity", url: "/w/acme/projects/ENG?view=sprints" },
  { kicker: "Analytics", title: "Data, not guesswork.", sub: "Cumulative flow, cycle time percentiles, lead time and throughput.", screen: "dashboard", spot: "flow", url: "/w/acme/projects/ENG?view=dashboard" },
  { kicker: "Automations", title: "Let the busywork run itself.", sub: "When this happens, do that. Or run it every Monday at 9.", screen: "automations", spot: "rule", url: "/w/acme/projects/ENG" },
  { kicker: "Integrations", title: "Works with the tools you already use.", sub: "Slack, Teams, Discord, Google Chat, GitHub and GitLab.", screen: "integrations", spot: "", url: "/w/acme/settings/integrations" },
  { kicker: "Security", title: "Enterprise-ready from day one.", sub: "SSO (SAML / OIDC), two-step sign-in, IP allow-lists, SCIM and audit logs.", screen: "security", spot: "", url: "/w/acme/settings/security" },
  { kicker: "See it yourself", title: "Watch the 9-minute tour.", sub: "Every screen, where it is and what it does, head to toe.", screen: "home", spot: "", url: "/how-it-works", play: true },
  { kicker: "Your turn", title: "Try it free.", sub: "", cta: true },
];

const W = 1080;
const H = 1350;
const SCALE = 1000 / 1280;

function Slide({ s, n }: { s: S; n: number }) {
  return (
    <section
      className="relative flex flex-col overflow-hidden text-white"
      style={{ width: W, height: H, breakAfter: "page", background: "radial-gradient(120% 80% at 0% 0%, #8e5cf0 0%, #7b68ee 40%, #4b3fc4 100%)" }}
    >
      <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-[#49ccf9]/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-52 -left-40 h-[560px] w-[560px] rounded-full bg-[#e44a8a]/25 blur-3xl" />

      <header className="relative flex items-center px-[60px] pt-[52px]">
        <span className="rounded-2xl bg-white px-4 py-2"><Logo className="text-[22px]" /></span>
        <span className="ml-auto text-[24px] font-semibold text-white/70">{String(n).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}</span>
      </header>

      {s.cta ? (
        <div className="relative flex flex-1 flex-col justify-center px-[60px]">
          <div className="text-[26px] font-bold uppercase tracking-[0.18em] text-[#bff0ff]">{s.kicker}</div>
          <h1 className="mt-4 text-[120px] font-extrabold leading-[1.02] tracking-tight">Try it free.</h1>
          <div className="mt-10 space-y-5 text-[36px] font-semibold">
            {["14-day free trial, no card needed", "From $3 per person a month", "Guests are always free", "236 automated tests behind it"].map((t) => (
              <div key={t} className="flex items-center gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[26px] text-primary">✓</span>{t}</div>
            ))}
          </div>
          <div className="mt-16 w-fit rounded-3xl bg-white px-10 py-7 text-[40px] font-extrabold text-primary shadow-2xl">Link in the comments 👇</div>
          <div className="mt-10 text-[30px] font-medium text-white/80">Feedback welcome · Follow for the build story</div>
        </div>
      ) : (
        <>
          <div className="relative px-[60px] pt-[56px]">
            <div className="text-[24px] font-bold uppercase tracking-[0.18em] text-[#bff0ff]">{s.kicker}</div>
            <h1 className="mt-3 text-[72px] font-extrabold leading-[1.05] tracking-tight">{s.title}</h1>
            <p className="mt-5 max-w-[900px] text-[32px] leading-snug text-white/85">{s.sub}</p>
          </div>
          <div className="relative mx-auto mt-[64px]">
            <div className="overflow-hidden rounded-[22px] bg-white shadow-[0_40px_80px_-20px_rgba(10,8,40,0.6)] ring-8 ring-white/15" style={{ width: 1280 * SCALE, height: 760 * SCALE }}>
              <div className="origin-top-left" style={{ transform: `scale(${SCALE})`, width: 1280, height: 760 }}>
                <TourStage screen={s.screen!} spot={s.spot ?? ""} url={s.url ?? "/"} />
              </div>
            </div>
            {s.play && (
              <div className="absolute inset-0 flex items-center justify-center rounded-[22px] bg-[#16171d]/45">
                <span className="flex h-40 w-40 items-center justify-center rounded-full bg-primary text-[64px] shadow-[0_20px_60px_-10px_rgba(123,104,238,0.9)] ring-8 ring-white/30">▶</span>
              </div>
            )}
          </div>
          <footer className="relative mt-auto flex items-center px-[60px] pb-[48px] text-[26px] font-semibold text-white/80">
            <span>Built by me, phase by phase</span>
            <span className="ml-auto flex items-center gap-3 rounded-full bg-white/15 px-6 py-2.5 text-white">Swipe →</span>
          </footer>
        </>
      )}
    </section>
  );
}

export default async function LinkedInSlides({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { n } = await searchParams;
  const only = n ? Number(n) : null;
  return (
    <div style={{ width: W }}>
      <style>{`@page { size: ${W}px ${H}px; margin: 0 } html, body { margin: 0; background: #4b3fc4 } [data-spot] { animation: none !important; } [data-spot][style*="z-index"] { box-shadow: 0 0 0 3px #7b68ee, 0 0 0 10px rgba(123,104,238,0.25) !important; } .animate-fade-up, .animate-slide-in { animation: none !important; } nextjs-portal { display: none !important; }`}</style>
      {SLIDES.map((s, i) => (only === null || only === i + 1 ? <Slide key={i} s={s} n={i + 1} /> : null))}
    </div>
  );
}
