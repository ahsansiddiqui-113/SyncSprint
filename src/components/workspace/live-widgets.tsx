"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Square } from "lucide-react";
import { listNotificationsAction, runningTimerAction, stopTimerAction } from "@/actions/collab.actions";
import { elapsedClock, emitSignal, formatMinutes, useSignal, useVisiblePoll } from "./signals";

/** Unread inbox count; pops a toast when something new arrives while you're working. */
export function useUnreadCount(organizationId: string, meId: string) {
  const [unread, setUnread] = useState(0);
  const last = useRef<number | null>(null);
  const router = useRouter();

  const load = useCallback(
    (announce: boolean) => {
      listNotificationsAction(organizationId, true).then((r) => {
        if (!r.ok) return;
        const prev = last.current;
        last.current = r.unread;
        setUnread(r.unread);
        const newest = r.items[0];
        if (announce && prev !== null && r.unread > prev && newest) {
          toast(newest.title, {
            description: newest.body ?? undefined,
            action: newest.link ? { label: "Open", onClick: () => router.push(newest.link!) } : undefined,
          });
        }
      });
    },
    [organizationId, router]
  );

  useEffect(() => load(false), [load]);
  useVisiblePoll(() => load(true), 30_000);
  useSignal((e) => {
    if (e.type === "NOTIFICATIONS_CHANGED" && e.userIds.includes(meId)) load(true);
    else if (e.type === "LOCAL_INBOX") load(false);
  });
  return unread;
}

type Running = { id: string; taskId: string; startedAt: string; ref: string; title: string; projectKey: string } | null;

/** Your running timer, visible from anywhere in the workspace, with a one-click stop. */
export function TimerPill({ org }: { org: { id: string; slug: string } }) {
  const [running, setRunning] = useState<Running>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, start] = useTransition();

  const load = useCallback(() => {
    runningTimerAction(org.id).then((r) => r.ok && setRunning(r.running));
  }, [org.id]);
  useEffect(load, [load]);
  useVisiblePoll(load, 60_000);
  useSignal((e) => (e.type === "LOCAL_TIMER" || e.type === "TIME_CHANGED") && load());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (!running) return null;
  return (
    <div className="mx-3 mt-3 flex items-center gap-2 rounded-xl border border-primary/25 bg-primary-soft px-3 py-2">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>
      <Link href={`/w/${org.slug}/projects/${running.projectKey}?task=${running.taskId}`} className="min-w-0 flex-1" title={running.title}>
        <span className="block font-mono text-[15px] font-semibold tabular-nums text-primary">{elapsedClock(running.startedAt, now)}</span>
        <span className="block truncate text-[12.5px] text-muted">
          {running.ref} · {running.title}
        </span>
      </Link>
      <button
        aria-label="Stop timer"
        disabled={pending}
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-white text-rose-600 shadow-card transition hover:bg-rose-50"
        onClick={() =>
          start(async () => {
            const r = await stopTimerAction(org.id);
            if (!r.ok) return void toast.error(r.message);
            toast.success(r.discarded ? "Timer discarded (under a minute)" : `Logged ${formatMinutes(r.minutes)} on ${running.ref}`);
            setRunning(null);
            emitSignal({ type: "LOCAL_TIMER" });
          })
        }
      >
        <Square className="h-3.5 w-3.5 fill-current" />
      </button>
    </div>
  );
}

