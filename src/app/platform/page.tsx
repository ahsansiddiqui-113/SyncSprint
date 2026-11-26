import { notFound } from "next/navigation";
import { db } from "@/db";
import { AppError } from "@/lib/errors";
import { requireUserOrRedirect } from "@/lib/session";
import { listCompanies, platformTotals } from "@/server/services/platform-admin";
import { PlatformConsole } from "@/components/platform/platform-console";

export const metadata = { title: "SyncSprint console", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The vendor's console. Everyone who isn't a platform owner gets a 404. */
export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const user = await requireUserOrRedirect("/platform");
  const { demo } = await searchParams;
  let rows;
  try {
    rows = await listCompanies(db, user.id, { includeDemo: demo === "1" });
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
  return (
    <PlatformConsole
      me={{ name: user.name }}
      includeDemo={demo === "1"}
      totals={platformTotals(rows)}
      companies={rows.map((r) => ({
        id: r.id, name: r.name, slug: r.slug, isDemo: r.isDemo, createdAt: r.createdAt.toISOString(), plan: r.plan, billingStatus: r.billingStatus,
        phase: r.state.phase, access: r.state.access, message: r.state.message, trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
        currentPeriodEnd: r.currentPeriodEnd?.toISOString() ?? null, cancelAtPeriodEnd: r.cancelAtPeriodEnd, suspendedReason: r.suspendedReason,
        hasSubscription: r.hasSubscription, billable: r.billable, viewers: r.viewers, admins: r.admins, monthlyRevenue: r.monthlyRevenue,
      }))}
    />
  );
}
