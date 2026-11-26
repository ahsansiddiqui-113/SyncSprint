"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Building2, ChevronDown, Copy, Loader2, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { PLANS, type PlanId } from "@/lib/billing-rules";
import { cn, formatDay, formatMoney, timeAgo } from "@/lib/utils";
import { companyEventsAction, platformActionAction, provisionCompanyAction } from "@/actions/business.actions";
import { Button } from "@/components/ui/button";
import { Card, Logo } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import type { PlatformAction } from "@/server/services/platform-admin";

type Company = {
  id: string; name: string; slug: string; isDemo: boolean; createdAt: string; plan: PlanId; billingStatus: string; phase: string; access: string; message: string | null;
  trialEndsAt: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; suspendedReason: string | null; hasSubscription: boolean;
  billable: number; viewers: number; admins: string[]; monthlyRevenue: number;
};
type Totals = { companies: number; paying: number; trials: number; atRisk: number; locked: number; mrr: number };

const PHASE: Record<string, { label: string; tone: string }> = {
  trial: { label: "Trial", tone: "bg-sky-50 text-sky-800" },
  active: { label: "Paying", tone: "bg-emerald-50 text-emerald-800" },
  comped: { label: "Complimentary", tone: "bg-emerald-50 text-emerald-800" },
  demo: { label: "Demo", tone: "bg-surface-2 text-muted" },
  ending: { label: "Canceling", tone: "bg-amber-50 text-amber-800" },
  grace: { label: "Overdue (grace)", tone: "bg-amber-50 text-amber-800" },
  read_only: { label: "Read-only", tone: "bg-rose-50 text-rose-800" },
  locked: { label: "Locked", tone: "bg-rose-50 text-rose-800" },
  suspended: { label: "Suspended", tone: "bg-rose-100 text-rose-900" },
};
const fmt = formatDay;

export function PlatformConsole({ me, totals, companies, includeDemo }: { me: { name: string }; totals: Totals; companies: Company[]; includeDemo: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | "paying" | "trial">("all");
  const [provisioning, setProvisioning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const shown = companies.filter((c) => {
    if (q && !`${c.name} ${c.slug} ${c.admins.join(" ")}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "attention") return ["grace", "read_only", "locked", "suspended", "ending"].includes(c.phase);
    if (filter === "paying") return c.monthlyRevenue > 0;
    if (filter === "trial") return c.phase === "trial";
    return true;
  });

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex items-center gap-3 border-b border-border bg-white px-8 py-3">
        <Logo className="text-[15px] [&_svg]:h-6 [&_svg]:w-6" />
        <span className="rounded-md bg-primary-soft px-2 py-0.5 text-[13px] font-semibold text-primary">Console</span>
        <span className="ml-auto text-[14px] text-muted">Signed in as {me.name} (platform owner)</span>
        <Link href="/w" className="text-[14px] font-medium text-primary hover:underline">Back to app</Link>
      </header>
      <main className="px-8 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
            <p className="mt-1 text-[15px] text-muted">Plans, payment status and access for every company. You can&apos;t see their work from here.</p>
          </div>
          <Button onClick={() => setProvisioning(true)}><Plus className="h-4 w-4" /> New company</Button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["Companies", totals.companies, ""],
            ["Paying", totals.paying, "text-emerald-700"],
            ["On trial", totals.trials, "text-sky-700"],
            ["Need attention", totals.atRisk, totals.atRisk ? "text-amber-700" : ""],
            ["Locked", totals.locked, totals.locked ? "text-rose-700" : ""],
            ["Monthly revenue", formatMoney(totals.mrr), ""],
          ].map(([label, value, tone]) => (
            <Card key={label as string} className="p-4">
              <div className="text-[13.5px] text-muted">{label}</div>
              <div className={cn("mt-1 text-2xl font-bold tabular-nums", tone as string)}>{value}</div>
            </Card>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Company, slug or admin email" aria-label="Search companies" className="h-10 w-72 pl-9" />
          </div>
          <div className="flex rounded-xl bg-surface-2 p-1" role="tablist">
            {([["all", "All"], ["attention", "Needs attention"], ["paying", "Paying"], ["trial", "Trials"]] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={cn("cursor-pointer rounded-lg px-3 py-1.5 text-[14px] font-medium text-muted", filter === id && "bg-white text-foreground shadow-card")}>{label}</button>
            ))}
          </div>
          <Link href={includeDemo ? "/platform" : "/platform?demo=1"} className="ml-auto text-[13.5px] text-muted hover:text-foreground">{includeDemo ? "Hide demo workspaces" : "Show demo workspaces"}</Link>
        </div>

        <Card className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-[14.5px]">
            <thead className="border-b border-border bg-surface-2 text-[12.5px] uppercase tracking-wide text-subtle">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Company</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Plan</th>
                <th className="px-4 py-2.5 font-semibold">Seats</th>
                <th className="px-4 py-2.5 font-semibold">Paid until / trial ends</th>
                <th className="px-4 py-2.5 text-right font-semibold">$/month</th>
                <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-subtle">No companies match.</td></tr>
              )}
              {shown.map((c) => (
                <CompanyRow key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} onChanged={() => router.refresh()} />
              ))}
            </tbody>
          </table>
        </Card>
      </main>
      {provisioning && <ProvisionDialog onClose={() => setProvisioning(false)} onDone={() => router.refresh()} />}
    </div>
  );
}

function CompanyRow({ c, open, onToggle, onChanged }: { c: Company; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [events, setEvents] = useState<{ id: string; type: string; source: string; summary: string | null; createdAt: string; actorName: string | null }[] | null>(null);
  const phase = PHASE[c.phase] ?? { label: c.phase, tone: "bg-surface-2" };

  const act = (action: PlatformAction, extra: { days?: number; reason?: string } = {}, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    start(async () => {
      const r = await platformActionAction(c.id, { action, ...extra });
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.summary);
      if (open) companyEventsAction(c.id).then((e) => e.ok && setEvents(e.events));
      onChanged();
    });
  };
  const toggle = () => {
    onToggle();
    if (!open) companyEventsAction(c.id).then((e) => (e.ok ? setEvents(e.events) : toast.error(e.message)));
  };

  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-surface-2/50">
        <td className="px-4 py-3">
          <button onClick={toggle} className="flex cursor-pointer items-center gap-2 text-left">
            <ChevronDown className={cn("h-4 w-4 text-subtle transition", open && "rotate-180")} />
            <span>
              <span className="block font-semibold">{c.name}</span>
              <span className="block text-[12.5px] text-subtle">{c.admins.join(", ") || "No admin yet (invite pending)"}</span>
            </span>
          </button>
        </td>
        <td className="px-4 py-3">
          <span className={cn("rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold", phase.tone)}>{phase.label}</span>
          {c.cancelAtPeriodEnd && c.phase === "active" && <span className="ml-1 text-[12px] text-amber-700">cancels</span>}
        </td>
        <td className="px-4 py-3">{PLANS[c.plan].name}</td>
        <td className="px-4 py-3 tabular-nums">{c.billable}<span className="text-subtle"> + {c.viewers} viewers</span></td>
        <td className="px-4 py-3">{c.plan === "trial" ? fmt(c.trialEndsAt) : fmt(c.currentPeriodEnd)}</td>
        <td className="px-4 py-3 text-right tabular-nums">{c.monthlyRevenue ? formatMoney(c.monthlyRevenue) : "—"}</td>
        <td className="px-4 py-3 text-right">
          <Popover
            align="right"
            trigger={() => (
              <Button size="sm" variant="ghost" aria-label={`Actions for ${c.name}`} disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
              </Button>
            )}
          >
            <div className="w-60 text-[14.5px]">
              {c.phase === "suspended" ? (
                <MenuItem onClick={() => act("reactivate", {}, `Reactivate ${c.name}?`)}>Reactivate</MenuItem>
              ) : (
                <MenuItem danger onClick={() => {
                  const reason = prompt(`Suspend ${c.name}? Everyone is locked out until you reactivate.\n\nReason (the company admin sees this):`, "Unpaid invoice");
                  if (reason) act("suspend", { reason });
                }}>Suspend (lock now)</MenuItem>
              )}
              <MenuItem onClick={() => act("extend_trial", { days: 7 })}>Extend trial by 7 days</MenuItem>
              {c.billingStatus === "past_due" && <MenuItem onClick={() => act("extend_grace", { days: 7 })}>Extend payment grace by 7 days</MenuItem>}
              {c.plan === "comped" ? (
                <MenuItem onClick={() => act("end_comp", {}, `End the free plan for ${c.name}? They get a 14-day trial to choose a plan.`)}>End complimentary plan</MenuItem>
              ) : (
                <MenuItem onClick={() => act("comp", {}, `Give ${c.name} SyncSprint for free?`)}>Make complimentary (free)</MenuItem>
              )}
              {c.hasSubscription && c.billingStatus !== "canceled" && (
                <>
                  <MenuItem onClick={() => act("cancel_at_period_end", {}, `Cancel ${c.name}'s subscription at the end of the paid period?`)}>Cancel at period end</MenuItem>
                  <MenuItem danger onClick={() => act("cancel_now", {}, `Cancel ${c.name}'s subscription immediately? This can't be undone from here.`)}>Cancel immediately</MenuItem>
                </>
              )}
            </div>
          </Popover>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-surface-2/40">
          <td colSpan={7} className="px-10 py-4">
            {c.message && <p className="mb-2 text-[14px] text-muted">{c.message}{c.suspendedReason ? ` Reason: ${c.suspendedReason}.` : ""}</p>}
            <p className="mb-2 text-[13px] text-subtle">Created {fmt(c.createdAt)} · workspace <code className="font-mono">{c.slug}</code></p>
            {events === null ? (
              <p className="text-[14px] text-subtle">Loading history…</p>
            ) : events.length === 0 ? (
              <p className="text-[14px] text-subtle">No billing events yet.</p>
            ) : (
              <ul className="space-y-1 text-[14px]">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="w-28 shrink-0 text-subtle">{timeAgo(e.createdAt)}</span>
                    <span className="w-20 shrink-0 font-mono text-[12.5px] text-subtle">{e.source}</span>
                    <span>{e.summary ?? e.type}{e.actorName ? <span className="text-subtle"> · {e.actorName}</span> : null}</span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("flex w-full cursor-pointer rounded-lg px-3 py-2 text-left hover:bg-hover", danger && "text-rose-600")}>
      {children}
    </button>
  );
}

function ProvisionDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [days, setDays] = useState("14");
  const [result, setResult] = useState<{ inviteUrl: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="New company">
      <div className="absolute inset-0 bg-[rgba(29,33,41,0.32)]" onClick={onClose} />
      <div className="relative m-auto w-full max-w-md rounded-2xl border border-border-strong bg-card p-6 shadow-lift">
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 cursor-pointer rounded-md p-1.5 text-subtle hover:bg-hover"><X className="h-4 w-4" /></button>
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Building2 className="h-5 w-5 text-primary" /> New company</h2>
        {result ? (
          <div className="mt-4 space-y-3">
            <p className="text-[15px]">Workspace created. Send this invite to the company&apos;s admin. When they accept, they can add their people. You are not a member.</p>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[13px]">{result.inviteUrl}</code>
              <Button size="sm" onClick={() => navigator.clipboard.writeText(result.inviteUrl).then(() => toast.success("Invite link copied"))}><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="text-[13px] text-subtle">The invite only works for {email} and expires in 14 days.</p>
            <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Done</Button></div>
          </div>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await provisionCompanyAction({ name, adminEmail: email, trialDays: Number(days) });
                if (!r.ok) return void toast.error(r.message);
                setResult({ inviteUrl: r.inviteUrl });
                onDone();
              });
            }}
          >
            <label className="block text-[14px] font-medium text-muted">Company name<Input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" maxLength={120} /></label>
            <label className="block text-[14px] font-medium text-muted">Admin&apos;s email<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" /></label>
            <label className="block text-[14px] font-medium text-muted">Free trial (days)<Input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className="mt-1.5" /></label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={pending || name.trim().length < 2 || !email.includes("@")}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Create & invite</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
