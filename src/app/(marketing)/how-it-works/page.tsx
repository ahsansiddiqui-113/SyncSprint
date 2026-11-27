import { ChevronRight } from "lucide-react";
import { getSession } from "@/lib/session";
import { TourPlayer } from "@/components/tour/tour-player";
import { CHAPTERS } from "@/components/tour/tour-slides";

export const metadata = {
  title: "How it works",
  description: "A guided tour of SyncSprint: where everything is and how it works, from sign-up to security.",
};

export default async function HowItWorksPage() {
  const session = await getSession();
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 pb-24 pt-10 sm:px-8">
      <header className="mb-8 max-w-3xl">
        <p className="text-[14px] font-bold uppercase tracking-wider text-primary">How it works</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl">The whole app, head to toe.</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-muted">
          Press play and watch. The tour walks through every screen, points at exactly where each thing lives and explains what it does.
          Pause any time, skip with the arrows, or jump straight to a chapter.
        </p>
      </header>

      <TourPlayer ctaHref={session ? "/w" : "/sign-up"} ctaLabel={session ? "Open my workspaces" : "Create your workspace"} />

      {/* Everything the tour says, as text: easy to skim, search and link to. */}
      <section className="mt-20" aria-labelledby="transcript">
        <h2 id="transcript" className="text-3xl font-extrabold tracking-tight">Read it instead</h2>
        <p className="mt-2 text-[16px] text-muted">The same tour as a guide. Each heading links to that moment in the video.</p>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {CHAPTERS.map((c, ci) => (
            <div key={c.id} id={`read-${c.id}`} className="rounded-2xl border border-border bg-white p-6 shadow-card">
              <h3 className="flex items-center gap-3 text-xl font-bold">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[14px] font-bold text-white" style={{ background: c.color }}>{ci + 1}</span>
                {c.title}
              </h3>
              <ul className="mt-4 space-y-4">
                {c.slides.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="text-[16px] font-semibold hover:text-primary hover:underline">{s.title}</a>
                    <p className="mt-0.5 text-[15px] leading-relaxed text-muted">{s.body}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[12.5px] text-subtle">
                      {s.where.map((w, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <ChevronRight className="h-3 w-3" />}
                          {w}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
