import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ChevronRight, Crown, Inbox, ListChecks } from "lucide-react";
import { db } from "@/db";
import { cn } from "@/lib/utils";
import { loadWorkspace, orNotFound } from "@/server/page-guards";
import { teamStats } from "@/server/services/teams";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Group" };

const LOAD = {
  over: { bar: "bg-rose-500", text: "text-rose-700", label: "Over" },
  near: { bar: "bg-amber-500", text: "text-amber-700", label: "Near" },
  ok: { bar: "bg-primary", text: "text-muted", label: "OK" },
  idle: { bar: "bg-border-strong", text: "text-subtle", label: "Free" },
} as const;

export default async function GroupPage({ params }: { params: Promise<{ orgSlug: string; teamId: string }> }) {
  const { orgSlug, teamId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(teamId)) notFound();
  const { user, org } = await loadWorkspace(orgSlug);
  const s = await orNotFound(() => teamStats(db, user.id, org.id, teamId));
  const maxWeek = Math.max(1, ...s.weeks.map((w) => w.done));

  return (
    <main className="w-full px-10 py-8 2xl:px-14">
      <nav className="mb-4 flex items-center gap-1.5 text-[14.5px] text-subtle" aria-label="Breadcrumb">
        <Link href={`/w/${org.slug}`} className="hover:text-foreground">{org.name}</Link>
        <ChevronRight className="h-4 w-4" />
        <Link href={`/w/${org.slug}/groups`} className="hover:text-foreground">Groups</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">{s.team.name}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: s.team.color }}>
          {s.team.name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{s.team.name}</h1>
          <p className="font-mono text-[14px] text-subtle">@{s.team.handle} · mention it in a comment to notify everyone</p>
        </div>
      </div>
      {s.team.description && <p className="mt-3 max-w-3xl text-[15.5px] text-muted">{s.team.description}</p>}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Open work" value={s.openTasks} hint="Assigned to the group or its people" />
        <Stat label="Waiting in queue" value={s.queue.length} hint="Sent to the group, nobody has taken it yet" />
        <Stat label="Overdue" value={s.overdue} hint="Open and past the due date" tone={s.overdue ? "bad" : undefined} />
        <Stat label="Finished this week" value={s.weeks.at(-1)?.done ?? 0} hint="Moved to Done in the last 7 days" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <h2 className="font-semibold">People this week</h2>
          <p className="text-[13.5px] text-subtle">Planned hours vs capacity ({s.week.from} – {s.week.to}) and time logged in the last 7 days.</p>
          {s.members.length === 0 ? (
            <p className="mt-4 text-[14.5px] text-subtle">No one is in this group yet.</p>
          ) : (
            <table className="mt-3 w-full text-[14.5px]">
              <caption className="sr-only">Workload and logged time per person</caption>
              <thead className="text-left text-[12.5px] uppercase tracking-wide text-subtle">
                <tr>
                  <th className="py-1.5 font-semibold">Person</th>
                  <th className="w-[38%] py-1.5 font-semibold">Planned vs capacity</th>
                  <th className="py-1.5 text-right font-semibold">Planned</th>
                  <th className="py-1.5 text-right font-semibold">Logged</th>
                </tr>
              </thead>
              <tbody>
                {s.members.map((m) => {
                  const l = m.load;
                  const tone = LOAD[l?.status ?? "idle"];
                  const pct = l && l.capacity ? Math.min(100, (l.planned / l.capacity) * 100) : l?.planned ? 100 : 0;
                  return (
                    <tr key={m.id} className="border-t border-border">
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <Avatar id={m.id} name={m.name} src={m.avatarUrl} size={24} />
                          {m.name}
                          {s.team.leadId === m.id && <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="Lead" />}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"><div className={cn("h-full rounded-full", tone.bar)} style={{ width: `${pct}%` }} /></div>
                          <span className={cn("w-10 text-right text-[12.5px] font-medium", tone.text)}>{tone.label}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums">{l ? `${l.planned}h / ${l.capacity}h` : "—"}</td>
                      <td className="py-2 text-right tabular-nums">{m.hoursThisWeek}h</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold"><ListChecks className="h-4 w-4 text-subtle" /> Finished per week</h2>
          <div className="mt-4 flex h-36 items-end gap-3" role="img" aria-label={`Tasks finished per week: ${s.weeks.map((w) => `${w.label}: ${w.done}`).join(", ")}`}>
            {s.weeks.map((w) => (
              <div key={w.label} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[13px] font-semibold tabular-nums">{w.done}</span>
                <div className="w-full rounded-t-md bg-primary" style={{ height: `${Math.max(4, (w.done / maxWeek) * 100)}px` }} />
                <span className="text-[12px] text-subtle">{w.label}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-subtle">Week starting (MM-DD). Counts tasks assigned to the group or its people.</p>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Inbox className="h-4 w-4 text-subtle" /> Group queue</h2>
        <p className="text-[13.5px] text-subtle">Work sent to {s.team.name} that nobody has picked up. Open a task and assign yourself to take it.</p>
        {s.queue.length === 0 ? (
          <p className="mt-3 text-[14.5px] text-subtle">The queue is empty.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {s.queue.map((q) => (
              <li key={q.id}>
                <Link href={`/w/${org.slug}/projects/${q.projectKey}?task=${q.id}`} className="flex items-center gap-3 py-2.5 text-[15px] hover:text-primary">
                  <span className="font-mono text-[13px] text-subtle">{q.ref}</span>
                  <span className="min-w-0 flex-1 truncate">{q.title}</span>
                  <span className="text-[13px] capitalize text-muted">{q.priority}</span>
                  {q.dueDate && <span className="text-[13px] text-subtle">due {q.dueDate}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint: string; tone?: "bad" }) {
  return (
    <Card className="p-4">
      <div className="text-[14px] text-muted">{label}</div>
      <div className={cn("mt-1 flex items-center gap-2 text-3xl font-bold tabular-nums", tone === "bad" && value > 0 && "text-rose-600")}>
        {tone === "bad" && value > 0 && <AlertTriangle className="h-6 w-6" />}
        {value}
      </div>
      <div className="mt-1 text-[12.5px] text-subtle">{hint}</div>
    </Card>
  );
}
