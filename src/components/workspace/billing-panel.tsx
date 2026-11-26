"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, CreditCard, ExternalLink, FlaskConical, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { PLANS, quote, suggestPlan, type PlanId } from "@/lib/billing-rules";
import { cn, formatDateTimeUtc, formatDay, formatMoney, timeAgo } from "@/lib/utils";
import { openBillingPortalAction, setSupportAccessAction, simulateBillingAction, startCheckoutAction } from "@/actions/business.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Data = {
  plan: PlanId;
  billingStatus: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  suspendedReason: string | null;
  hasSubscription: boolean;
  supportAccessUntil: string | null;
  seatOverageSince: string | null;
  state: { access: "full" | "read_only" | "locked"; phase: string; message: string | null; deleteAfter: string | null };
  seats: { billable: number; viewers: number; purchased: number | null; max: number | null };
  events: { id: string; type: string; source: string; summary: string | null; createdAt: string }[];
  payments: { enabled: boolean; sandbox: boolean; devSimulator: boolean };
};

const fmtDate = formatDay;
const usd = formatMoney;

const PHASE: Record<string, { label: string; tone: string }> = {
  trial: { label: "Free trial", tone: "bg-sky-50 text-sky-800 border-sky-200" },
  active: { label: "Active", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  comped: { label: "Complimentary", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  demo: { label: "Demo (not billed)", tone: "bg-surface-2 text-muted border-border" },
  ending: { label: "Canceled — ends soon", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  grace: { label: "Payment overdue", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  read_only: { label: "Read-only", tone: "bg-rose-50 text-rose-800 border-rose-200" },
  locked: { label: "Locked", tone: "bg-rose-50 text-rose-800 border-rose-200" },
  suspended: { label: "Suspended", tone: "bg-rose-50 text-rose-800 border-rose-200" },
};

const SIMS = [
  ["subscribe_payg", "Subscribe: Pay as you go"],
  ["subscribe_team", "Subscribe: Team"],
  ["subscribe_business", "Subscribe: Business"],
  ["payment_failed", "Payment fails"],
  ["payment_recovered", "Payment recovered"],
  ["cancel_at_period_end", "Cancel at period end"],
  ["subscription_ended", "Subscription ends"],
  ["expire_grace", "Fast-forward: grace/trial runs out"],
] as const;

export function BillingPanel({ organizationId, orgSlug, isDemo, justCheckedOut, data }: { organizationId: string; orgSlug: string; isDemo: boolean; justCheckedOut: boolean; data: Data }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const phase = PHASE[data.state.phase] ?? PHASE.active!;
  const people = data.seats.billable;
  const fit = suggestPlan(people);
  const supportOn = !!data.supportAccessUntil && new Date(data.supportAccessUntil) > new Date();

  useEffect(() => {
    if (justCheckedOut) toast.success("Thanks! Your payment is being confirmed — this page updates in a few seconds.");
    if (!justCheckedOut) return;
    const id = setTimeout(() => router.replace(`/w/${orgSlug}/settings/billing`), 4000);
    return () => clearTimeout(id);
  }, [justCheckedOut, orgSlug, router]);

  const checkout = (plan: PlanId) =>
    start(async () => {
      const r = await startCheckoutAction(organizationId, plan);
      if (!r.ok) return void toast.error(r.message);
      window.location.href = r.url;
    });
  const portal = () =>
    start(async () => {
      const r = await openBillingPortalAction(organizationId, orgSlug);
      if (!r.ok) return void toast.error(r.message);
      window.location.href = r.url;
    });

  return (
    <div className="space-y-6">
      {/* status */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold">{PLANS[data.plan].name}</h2>
            <span className={cn("rounded-full border px-2.5 py-0.5 text-[13px] font-semibold", phase.tone)}>{phase.label}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[14.5px] sm:grid-cols-3">
            {data.plan === "trial" && (
              <div>
                <dt className="text-subtle">Trial ends</dt>
                <dd className="font-medium">{fmtDate(data.trialEndsAt)}</dd>
              </div>
            )}
            {data.currentPeriodEnd && (
              <div>
                <dt className="text-subtle">{data.cancelAtPeriodEnd || data.billingStatus === "canceled" ? "Access until" : "Renews"}</dt>
                <dd className="font-medium">{fmtDate(data.currentPeriodEnd)}</dd>
              </div>
            )}
            <div>
              <dt className="text-subtle">Paid seats (admins + members)</dt>
              <dd className="font-medium">
                {people}
                {data.seats.max ? ` of ${data.seats.max}` : ""}
                {data.seats.purchased ? <span className="text-subtle"> · {data.seats.purchased} billed</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-subtle">Viewers</dt>
              <dd className="font-medium">{data.seats.viewers} <span className="text-subtle">(free)</span></dd>
            </div>
          </dl>
          {data.state.message && (
            <p className={cn("mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-[14.5px]", data.state.access === "full" ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-900")}>
              {data.state.access === "full" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>
                {data.state.message}
                {data.suspendedReason && <> Reason: {data.suspendedReason}.</>}
                {data.state.deleteAfter && <> Data is kept until {fmtDate(data.state.deleteAfter)}.</>}
              </span>
            </p>
          )}
          {data.seatOverageSince && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[14.5px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              You have more people than your plan covers. Upgrade within 7 days of {fmtDate(data.seatOverageSince)}, or make some people viewers (free); after that, new members can&apos;t be added.
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {data.hasSubscription && data.payments.enabled && (
              <Button variant="outline" disabled={pending} onClick={portal}>
                <CreditCard className="h-4 w-4" /> Manage billing <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          {data.hasSubscription && data.payments.enabled && (
            <p className="mt-2 text-[13px] text-subtle">Update your card, download invoices, change seats or cancel in the secure billing portal.</p>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" /> Support access</h3>
          <p className="mt-1 text-[14px] text-muted">
            The SyncSprint team can&apos;t see your work. If you need help, let them look in, read-only, for a limited time. Everything they open is logged.
          </p>
          <p className="mt-3 text-[14px] font-medium">{supportOn ? `On until ${formatDateTimeUtc(data.supportAccessUntil!)}` : "Off"}</p>
          <div className="mt-3 flex gap-2">
            {supportOn ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
                const r = await setSupportAccessAction(organizationId, 0);
                if (!r.ok) return void toast.error(r.message);
                router.refresh();
              })}>Turn off</Button>
            ) : (
              <Button size="sm" variant="outline" disabled={pending || isDemo} onClick={() => start(async () => {
                const r = await setSupportAccessAction(organizationId, 24);
                if (!r.ok) return void toast.error(r.message);
                toast.success("Support can view this workspace for 24 hours");
                router.refresh();
              })}>Allow for 24 hours</Button>
            )}
          </div>
        </Card>
      </div>

      {/* plans */}
      {!isDemo && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">Plans</h2>
          <p className="mb-4 text-[14.5px] text-muted">
            Prices for your {people} paid {people === 1 ? "seat" : "seats"}. Viewers are free on every plan. Above 100 people, contact us.
          </p>
          {!data.payments.enabled && (
            <p className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[14px] text-muted">
              Online payments aren&apos;t connected on this server yet{data.payments.devSimulator ? " — use the simulator below to try every billing state locally." : "."}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            {(["payg", "team", "business"] as const).map((id) => {
              const p = PLANS[id];
              const q = quote(id, people);
              const tooMany = p.maxSeats !== null && people > p.maxSeats;
              const current = data.plan === id && data.state.access !== "locked" && data.billingStatus !== "canceled";
              const recommended = fit === id && !current;
              return (
                <Card key={id} className={cn("flex flex-col p-5", recommended && "border-primary/50 ring-2 ring-primary/20", current && "border-emerald-300")}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[17px] font-semibold">{p.name}</h3>
                    {recommended && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-semibold text-primary">Best fit</span>}
                    {current && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-700">Current</span>}
                  </div>
                  <p className="mt-1 text-[14px] text-muted">{p.blurb}</p>
                  <div className="mt-4">
                    <span className="text-3xl font-bold">{usd(p.pricePerSeat)}</span>
                    <span className="text-[14px] text-muted"> / person / month{p.interval === "year" ? ", billed yearly" : ""}</span>
                  </div>
                  <p className="mt-1 text-[14px] text-muted">
                    {tooMany ? `Covers up to ${p.maxSeats} people` : <>For you: <b className="text-foreground">{usd(q.monthly)}/month</b>{p.interval === "year" ? ` (${usd(q.perPeriod)}/year)` : ""} · {q.seats} seats{q.seats > people ? " (plan minimum)" : ""}</>}
                  </p>
                  <ul className="mt-4 flex-1 space-y-1.5 text-[14px]">
                    {["Every feature: boards, sprints, docs, goals, automations", "Groups, workload & capacity", "Unlimited free viewers & share links", "REST API & webhooks"].map((f) => (
                      <li key={f} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> {f}</li>
                    ))}
                  </ul>
                  <Button className="mt-5" variant={recommended ? "default" : "outline"} disabled={pending || tooMany || current || !data.payments.enabled || (data.hasSubscription && data.billingStatus !== "canceled")} onClick={() => checkout(id)}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {current ? "Your plan" : data.hasSubscription && data.billingStatus !== "canceled" ? "Change in Manage billing" : `Choose ${p.name}`}
                  </Button>
                </Card>
              );
            })}
          </div>
          <p className="mt-3 text-[13px] text-subtle">
            Payments, tax and invoices are handled by Polar (our merchant of record). Paid seats follow your team automatically: adding or removing a member adjusts your bill, prorated.
          </p>
        </section>
      )}

      {data.payments.devSimulator && !isDemo && (
        <Card className="border-dashed p-5">
          <h3 className="flex items-center gap-2 font-semibold"><FlaskConical className="h-4 w-4 text-primary" /> Billing simulator (local development only)</h3>
          <p className="mt-1 text-[14px] text-muted">Runs the real billing code with a pretend subscription, so you can see every state without a card. Not available in production.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SIMS.map(([id, label]) => (
              <Button key={id} size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
                const r = await simulateBillingAction(organizationId, id);
                if (!r.ok) return void toast.error(r.message);
                toast.success(label);
                router.refresh();
              })}>{label}</Button>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="font-semibold">Billing history</h3>
        {data.events.length === 0 ? (
          <p className="mt-2 text-[14px] text-subtle">Nothing yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-[14px]">
            {data.events.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-subtle">{e.source}</span>
                <span className="min-w-0 flex-1">{e.summary ?? e.type}</span>
                <span className="shrink-0 text-subtle">{timeAgo(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
