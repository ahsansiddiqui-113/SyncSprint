"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AtSign, BellOff, CheckCheck, CheckCircle2, Gauge, MessageSquare, UserPlus, Zap } from "lucide-react";
import type { NotificationKind } from "@/db/schema";
import { listNotificationsAction, markNotificationsReadAction } from "@/actions/collab.actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, timeAgo } from "@/lib/utils";
import { emitSignal, useSignal } from "./signals";

type Item = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorAvatar: string | null;
};

const KIND: Record<NotificationKind, { label: string; icon: typeof AtSign; tone: string }> = {
  mention: { label: "Mention", icon: AtSign, tone: "bg-amber-100 text-amber-800" },
  assigned: { label: "Assigned", icon: UserPlus, tone: "bg-primary-soft text-primary" },
  comment: { label: "Comment", icon: MessageSquare, tone: "bg-sky-100 text-sky-800" },
  completed: { label: "Completed", icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-800" },
  capacity: { label: "Workload", icon: Gauge, tone: "bg-rose-100 text-rose-800" },
  automation: { label: "Automation", icon: Zap, tone: "bg-violet-100 text-violet-800" },
};

const TABS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "mention", label: "Mentions" },
  { id: "assigned", label: "Assigned to me" },
] as const;

export function InboxList({ organizationId, meId }: { organizationId: string; meId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [pending, start] = useTransition();

  const load = useCallback(() => {
    listNotificationsAction(organizationId).then((r) => r.ok && setItems(r.items));
  }, [organizationId]);
  useEffect(load, [load]);
  useSignal((e) => e.type === "NOTIFICATIONS_CHANGED" && e.userIds.includes(meId) && load());

  const shown = useMemo(() => {
    const all = items ?? [];
    if (tab === "unread") return all.filter((n) => !n.readAt);
    if (tab === "mention" || tab === "assigned") return all.filter((n) => n.kind === tab);
    return all;
  }, [items, tab]);
  const unread = (items ?? []).filter((n) => !n.readAt).length;

  const markRead = (ids: string[]) =>
    start(async () => {
      const r = await markNotificationsReadAction(organizationId, ids);
      if (!r.ok) return void toast.error(r.message);
      const now = new Date().toISOString();
      setItems((xs) => xs?.map((n) => (!ids.length || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)) ?? null);
      emitSignal({ type: "LOCAL_INBOX" });
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl bg-surface-2 p-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "cursor-pointer rounded-lg px-3.5 py-1.5 text-[15px] font-medium text-muted transition",
                tab === t.id && "bg-white text-foreground shadow-card"
              )}
            >
              {t.label}
              {t.id === "unread" && unread > 0 && <span className="ml-1.5 text-primary">{unread}</span>}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="ml-auto" disabled={pending || unread === 0} onClick={() => markRead([])}>
          <CheckCheck className="h-4 w-4" /> Mark all as read
        </Button>
      </div>

      <Card className="overflow-hidden">
        {items === null && <p className="p-8 text-center text-[15px] text-subtle">Loading…</p>}
        {items !== null && shown.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-12 text-center">
            <BellOff className="h-8 w-8 text-subtle" />
            <p className="text-[16px] font-medium">You're all caught up</p>
            <p className="text-[15px] text-subtle">New mentions, assignments and updates on work you follow will show up here.</p>
          </div>
        )}
        {shown.map((n) => {
          const k = KIND[n.kind];
          const Inner = (
            <>
              <div className="relative shrink-0">
                <Avatar id={n.actorId ?? "system"} name={n.actorName ?? "SyncSprint"} src={n.actorAvatar} size={36} />
                <span className={cn("absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-white", k.tone)}>
                  <k.icon className="h-3 w-3" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={cn("truncate text-[15.5px]", n.readAt ? "text-foreground" : "font-semibold")}>{n.title}</span>
                  {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </div>
                {n.body && <p className="mt-0.5 line-clamp-2 text-[14.5px] text-muted">{n.body}</p>}
                <div className="mt-1 flex items-center gap-2 text-[13px] text-subtle">
                  <span className={cn("rounded px-1.5 py-px text-[12px] font-medium", k.tone)}>{k.label}</span>
                  <span title={n.createdAt}>{timeAgo(n.createdAt)}</span>
                </div>
              </div>
            </>
          );
          const cls = cn(
            "group flex items-start gap-3.5 border-b border-border px-5 py-4 transition-colors last:border-0 hover:bg-surface-2",
            !n.readAt && "bg-primary-soft/40"
          );
          return n.link ? (
            <Link key={n.id} href={n.link} className={cls} onClick={() => !n.readAt && markRead([n.id])}>
              {Inner}
            </Link>
          ) : (
            <div key={n.id} className={cls}>
              {Inner}
              {!n.readAt && (
                <Button size="sm" variant="ghost" onClick={() => markRead([n.id])}>
                  Mark read
                </Button>
              )}
            </div>
          );
        })}
      </Card>
    </>
  );
}
