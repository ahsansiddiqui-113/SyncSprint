"use client";

import { useEffect, useRef } from "react";
import type { OrgEvent } from "@/lib/realtime-protocol";

/**
 * A tiny in-page event bus so pieces of the workspace that don't own the
 * WebSocket (sidebar inbox, timer pill, drawer sections) can react to org events.
 * The board's realtime hook re-emits every server event here; local actions emit
 * too, so the UI updates instantly even in polling mode.
 */
const NAME = "syncsprint:event";

export type LocalSignal = OrgEvent | { type: "LOCAL_TIMER" } | { type: "LOCAL_INBOX" };

export function emitSignal(e: LocalSignal) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<LocalSignal>(NAME, { detail: e }));
}

export function useSignal(handler: (e: LocalSignal) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (ev: Event) => ref.current((ev as CustomEvent<LocalSignal>).detail);
    window.addEventListener(NAME, on);
    return () => window.removeEventListener(NAME, on);
  }, []);
}

/** Call `fn` every `ms` while the tab is visible, and when it becomes visible again. */
export function useVisiblePoll(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && ref.current();
    const id = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms]);
}

/** "1h 05m" / "25m" for minute totals. */
export function formatMinutes(min: number) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h ${String(r).padStart(2, "0")}m` : `${r}m`;
}

/** "0:12:34" stopwatch text from a start ISO timestamp. */
export function elapsedClock(startIso: string, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
