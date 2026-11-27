import { db } from "@/db";
import { isAdminRole } from "@/lib/rbac-shared";
import { loadWorkspaceAnyState } from "@/server/page-guards";
import { getBillingOverview } from "@/server/services/billing";
import { Card, PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { BillingPanel } from "@/components/workspace/billing-panel";

export const metadata = { title: "Billing & plan" };

export default async function BillingPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ checkout_id?: string }> }) {
  const { orgSlug } = await params;
  const { checkout_id } = await searchParams;
  const { user, org, role, viaSupport } = await loadWorkspaceAnyState(orgSlug);
  if (!isAdminRole(role) || viaSupport) {
    return (
      <main className="w-full px-10 py-10 2xl:px-14">
        <PageHeader eyebrow={<Breadcrumbs items={[{ label: org.name, href: `/w/${org.slug}` }, { label: "Settings" }, { label: "Billing & plan" }]} />} title="Billing & plan" />
        <Card className="p-8 text-center text-[15px] text-muted">Only this workspace&apos;s admins can see and change billing.</Card>
      </main>
    );
  }
  const o = await getBillingOverview(db, user.id, org.id);
  return (
    <main className="w-full px-10 py-10 2xl:px-14">
      <PageHeader eyebrow={<Breadcrumbs items={[{ label: org.name, href: `/w/${org.slug}` }, { label: "Settings" }, { label: "Billing & plan" }]} />} title="Billing & plan" description="Your plan, seats and payments. Viewers are always free." />
      <BillingPanel
        organizationId={org.id}
        orgSlug={org.slug}
        isDemo={org.isDemo}
        justCheckedOut={!!checkout_id}
        data={{
          plan: o.org.plan,
          billingStatus: o.org.billingStatus,
          trialEndsAt: o.org.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: o.org.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: o.org.cancelAtPeriodEnd,
          suspendedReason: o.org.suspendedReason,
          hasSubscription: o.org.hasSubscription,
          supportAccessUntil: o.org.supportAccessUntil?.toISOString() ?? null,
          seatOverageSince: o.org.seatOverageSince?.toISOString() ?? null,
          state: { access: o.state.access, phase: o.state.phase, message: o.state.message, deleteAfter: o.state.deleteAfter?.toISOString() ?? null },
          seats: o.seats,
          events: o.events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
          payments: o.payments,
        }}
      />
    </main>
  );
}
