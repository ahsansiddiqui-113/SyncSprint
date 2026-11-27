"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, MousePointer2, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHAPTERS, SLIDES, slideDuration } from "./tour-slides";
import { STAGE_H, STAGE_W, TourStage } from "./tour-mocks";

const TOTAL_MS = SLIDES.reduce((n, s) => n + slideDuration(s), 0);
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/**
 * "How it works" as a video you can steer: it plays slide by slide on its own (with an optional
 * spoken narration), a cursor points at the exact place in the app, and every chapter is clickable.
 */
export function TourPlayer({ ctaHref, ctaLabel }: { ctaHref: string; ctaLabel: string }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [narrate, setNarrate] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [scale, setScale] = useState(0.5);
  const [cursor, setCursor] = useState({ x: STAGE_W / 2, y: STAGE_H / 2 });
  const [full, setFull] = useState(false);

  const shellRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const spokenRef = useRef(true);
  const elapsedRef = useRef(0);
  const slide = SLIDES[index];
  const duration = slideDuration(slide);

  /* ---------- fit the 1280×760 stage into whatever width we have */
  useLayoutEffect(() => {
    const el = fitRef.current;
    if (!el) return;
    const fit = () => {
      const byWidth = el.clientWidth / STAGE_W;
      const byHeight = document.fullscreenElement ? (window.innerHeight - 300) / STAGE_H : Infinity;
      setScale(Math.max(0.15, Math.min(byWidth, byHeight)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);

  useEffect(() => setCanSpeak(typeof window !== "undefined" && "speechSynthesis" in window), []);

  /* ---------- deep link: /how-it-works#swimlanes */
  useEffect(() => {
    const open = (scroll: boolean) => {
      const id = window.location.hash.slice(1);
      const i = SLIDES.findIndex((s) => s.id === id || s.chapter.id === id);
      if (i < 0) return;
      setIndex(i);
      elapsedRef.current = 0;
      setElapsed(0);
      setEnded(false);
      if (i > 0 || scroll) setStarted(true);
      if (scroll) shellRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    open(false);
    const onHash = () => open(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((i: number) => {
    const next = Math.max(0, Math.min(SLIDES.length - 1, i));
    setIndex(next);
    elapsedRef.current = 0;
    setElapsed(0);
    setEnded(false);
    setStarted(true);
    try { history.replaceState(null, "", `#${SLIDES[next].id}`); } catch {}
  }, []);

  /* ---------- point the cursor at this slide's spot (after the screen has drawn) */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const stage = stageRef.current;
      const el = stage?.querySelector<HTMLElement>(`[data-spot="${slide.spot}"]`);
      if (!stage || !el) return;
      const scroller = el.closest<HTMLElement>("[data-scroll]");
      if (scroller) {
        const top = (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) / scale + scroller.scrollTop;
        scroller.scrollTop = Math.max(0, top - 24);
      }
      const s = stage.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const x = (r.left - s.left + Math.min(r.width / 2, 160)) / scale;
      const y = (r.top - s.top + Math.min(r.height / 2, 90)) / scale;
      setCursor({ x: Math.min(STAGE_W - 30, Math.max(10, x)), y: Math.min(STAGE_H - 30, Math.max(10, y)) });
    }, 120);
    return () => window.clearTimeout(t);
  }, [index, slide.spot, scale]);

  /* ---------- narration */
  useEffect(() => {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    if (!playing || !narrate) {
      spokenRef.current = true;
      return;
    }
    spokenRef.current = false;
    const u = new SpeechSynthesisUtterance(`${slide.title}. ${slide.body.replace(/•••/g, "the more menu")}`);
    u.rate = 1.02;
    u.onend = () => { spokenRef.current = true; };
    u.onerror = () => { spokenRef.current = true; };
    window.speechSynthesis.speak(u);
    return () => window.speechSynthesis.cancel();
  }, [index, playing, narrate, canSpeak, slide.title, slide.body]);

  /* ---------- the clock */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsedRef.current = Math.min(duration, elapsedRef.current + (now - last));
      last = now;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= duration && spokenRef.current) {
        if (index >= SLIDES.length - 1) {
          setPlaying(false);
          setEnded(true);
        } else go(index + 1);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, index, go]);

  const play = useCallback(() => {
    if (ended) { go(0); }
    setStarted(true);
    setPlaying(true);
  }, [ended, go]);
  const toggle = useCallback(() => (playing ? setPlaying(false) : play()), [playing, play]);

  /* ---------- keyboard: space, arrows, f */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(index + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(index - 1); }
      else if (e.key === "f") { e.preventDefault(); void toggleFull(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  async function toggleFull() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen();
    } catch {}
  }

  const doneBefore = SLIDES.slice(0, index).reduce((n, s) => n + slideDuration(s), 0);
  const overall = doneBefore + elapsed;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div ref={shellRef} className={cn("min-w-0 scroll-mt-24", full && "flex flex-col justify-center bg-[#16171d] p-6")}>
        {/* ---------- the "video" */}
        <div ref={fitRef} className={cn("mx-auto w-full", full && "max-w-[calc((100vh-300px)*1280/760)]")}>
          <div className="overflow-hidden rounded-2xl border border-border bg-[#16171d] shadow-lift">
          <div className="relative overflow-hidden bg-white" style={{ height: STAGE_H * scale }}>
            <div ref={stageRef} className="absolute left-0 top-0 origin-top-left" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }} aria-hidden>
              <TourStage screen={slide.screen} spot={started ? slide.spot : ""} url={slide.url} />
              {started && (
                <>
                  <span
                    key={`ripple-${index}`}
                    className="pointer-events-none absolute z-30 h-12 w-12 rounded-full border-4 border-primary"
                    style={{ left: cursor.x, top: cursor.y, animation: "tour-ripple 0.9s ease-out 0.9s both" }}
                  />
                  <MousePointer2
                    className="pointer-events-none absolute z-40 h-8 w-8 fill-[#16171d] text-white drop-shadow-lg transition-[left,top] duration-[900ms] ease-[cubic-bezier(0.6,0,0.2,1)] motion-reduce:transition-none"
                    style={{ left: cursor.x - 4, top: cursor.y - 3 }}
                    strokeWidth={1.5}
                  />
                </>
              )}
            </div>

            {/* start / end screens */}
            {(!started || ended) && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#16171d]/55 px-6 text-center text-white backdrop-blur-[2px]">
                <div className="text-[13px] font-semibold uppercase tracking-wider text-white/80">{ended ? "That's everything" : `How SyncSprint works · ${fmt(TOTAL_MS)}`}</div>
                <div className="mt-2 max-w-xl text-[22px] font-extrabold tracking-tight sm:text-[34px]">{ended ? "You've seen it head to toe." : "Every screen, where it is and what it does."}</div>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button onClick={play} className="flex h-14 cursor-pointer items-center gap-2 rounded-full bg-primary pl-5 pr-6 text-[17px] font-semibold shadow-glow transition-transform hover:scale-105">
                    {ended ? <RotateCcw className="h-6 w-6" /> : <Play className="h-6 w-6 fill-white" />} {ended ? "Watch again" : "Play the tour"}
                  </button>
                  {ended && <Link href={ctaHref} className="flex h-14 items-center rounded-full bg-white px-6 text-[17px] font-semibold text-foreground">{ctaLabel}</Link>}
                </div>
                {!ended && <p className="mt-4 text-[13.5px] text-white/75">Space to pause · ← → to skip · F for full screen</p>}
              </div>
            )}
          </div>
          {/* subtitles: under the picture so they never hide what the cursor points at */}
          <div className="min-h-[76px] px-5 py-3 text-white sm:min-h-[104px] sm:px-7 sm:py-4">
            <div key={slide.id} className="max-w-4xl animate-fade-up">
              <div className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: slide.chapter.color }}>
                Chapter {slide.chapterIndex + 1} · {slide.chapter.title}
              </div>
              <div className="mt-0.5 text-[17px] font-bold sm:text-[20px]">{slide.title}</div>
              <p className="mt-1 hidden text-[14.5px] leading-relaxed text-white/85 sm:block">{slide.body}</p>
            </div>
          </div>
          </div>
        </div>

        {/* ---------- scrubber: one segment per slide, coloured by chapter */}
        <div className={cn("mx-auto mt-3 w-full", full && "max-w-[calc((100vh-300px)*1280/760)]")}>
          <div className="flex h-2.5 gap-[3px]" role="group" aria-label="Tour progress">
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                onClick={() => go(i)}
                title={`${s.chapter.title}: ${s.title}`}
                aria-label={`Go to ${s.title}`}
                className="relative flex-1 cursor-pointer overflow-hidden rounded-full bg-border transition-transform hover:scale-y-150"
              >
                <span
                  className="absolute inset-y-0 left-0"
                  style={{ background: s.chapter.color, width: i < index ? "100%" : i === index ? `${(elapsed / duration) * 100}%` : "0%" }}
                />
              </button>
            ))}
          </div>

          {/* ---------- controls */}
          <div className={cn("mt-3 flex flex-wrap items-center gap-2", full ? "text-white" : "")}>
            <CtrlButton label="Previous" onClick={() => go(index - 1)} disabled={index === 0} dark={full}><ChevronLeft className="h-5 w-5" /></CtrlButton>
            <button
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-primary text-white shadow-glow transition-transform hover:scale-105"
            >
              {playing ? <Pause className="h-5 w-5 fill-white" /> : <Play className="ml-0.5 h-5 w-5 fill-white" />}
            </button>
            <CtrlButton label="Next" onClick={() => go(index + 1)} disabled={index === SLIDES.length - 1} dark={full}><ChevronRight className="h-5 w-5" /></CtrlButton>
            <span className={cn("ml-1 text-[14px] tabular-nums", full ? "text-white/70" : "text-muted")}>
              {fmt(overall)} / {fmt(TOTAL_MS)} · {index + 1} of {SLIDES.length}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {canSpeak && (
                <CtrlButton label={narrate ? "Turn narration off" : "Read it aloud"} onClick={() => setNarrate((n) => !n)} active={narrate} dark={full} wide>
                  {narrate ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} <span className="hidden sm:inline">{narrate ? "Voice on" : "Voice off"}</span>
                </CtrlButton>
              )}
              <CtrlButton label={full ? "Exit full screen" : "Full screen"} onClick={() => void toggleFull()} dark={full}>
                {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </CtrlButton>
            </span>
          </div>

          {/* where-to-find-it trail (also readable on phones, where the caption is shortened) */}
          {!full && (
            <div className="mt-4 rounded-xl border border-border bg-surface-2/60 p-4">
              <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                <span className="mr-1 font-semibold text-muted">Where to find it:</span>
                {slide.where.map((w, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-subtle" />}
                    <span className="rounded-md border border-border bg-white px-2 py-0.5 font-medium">{w}</span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[14.5px] leading-relaxed text-muted sm:hidden">{slide.body}</p>
            </div>
          )}
        </div>
      </div>

      {/* ---------- chapters */}
      <nav aria-label="Chapters" className="max-h-[720px] overflow-y-auto rounded-2xl border border-border bg-white p-2 xl:sticky xl:top-24">
        {CHAPTERS.map((c, ci) => {
          const first = SLIDES.findIndex((s) => s.chapter.id === c.id);
          const inChapter = slide.chapter.id === c.id;
          return (
            <div key={c.id} className="mb-1">
              <button
                onClick={() => go(first)}
                className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14.5px] font-semibold transition-colors hover:bg-hover", inChapter && "bg-surface-2")}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-bold text-white" style={{ background: c.color }}>{ci + 1}</span>
                <span className="flex-1">{c.title}</span>
                <span className="text-[12px] font-normal text-subtle">{c.slides.length}</span>
              </button>
              {inChapter && (
                <ol className="mb-1 ml-[22px] border-l border-border pl-3">
                  {c.slides.map((s) => {
                    const i = SLIDES.findIndex((x) => x.id === s.id);
                    return (
                      <li key={s.id}>
                        <button
                          onClick={() => go(i)}
                          aria-current={i === index ? "step" : undefined}
                          className={cn("w-full cursor-pointer rounded-md px-2 py-1 text-left text-[13.5px] transition-colors hover:bg-hover", i === index ? "font-semibold text-primary" : i < index ? "text-subtle" : "text-muted")}
                        >
                          {s.title}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}

function CtrlButton({ children, label, onClick, disabled, active, dark, wide }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean; dark?: boolean; wide?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full border text-[13.5px] font-medium transition-colors disabled:cursor-default disabled:opacity-40",
        wide ? "px-3.5" : "w-10",
        dark ? "border-white/20 text-white hover:bg-white/10" : "border-border-strong bg-white hover:bg-hover",
        active && (dark ? "bg-white/15" : "border-primary/40 bg-primary-soft text-primary")
      )}
    >
      {children}
    </button>
  );
}
