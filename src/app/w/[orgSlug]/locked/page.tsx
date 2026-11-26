import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { isAdminRole } from "@/lib/rbac-shared";
import { loadWorkspaceAnyState } from "@/server/page-guards";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Workspace locked" };

export default async function LockedPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const { org, role, billing } = await loadWorkspaceAnyState(orgSlug);
  if (billing.access !== "locked") redirect(`/w/${orgSlug}`);
  const admin = isAdminRole(role);
  return (
    <main className="flex min-h-full items-center justify-center p-10">
      <Card className="max-w-lg p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <Lock className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{org.name} is locked</h1>
        <p className="mt-2 text-[15.5px] leading-relaxed text-muted">{billing.message}</p>
        {billing.deleteAfter && (
          <p className="mt-3 text-[14px] text-subtle">
            Your data is kept safe until {billing.deleteAfter.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.
          </p>
        )}
        {admin ? (
          <Link href={`/w/${org.slug}/settings/billing`} className={buttonVariants({ className: "mt-6" })}>
            Resolve billing
          </Link>
        ) : (
          <p className="mt-6 rounded-lg bg-surface-2 px-4 py-3 text-[14.5px]">Please contact your workspace admin. Nothing has been deleted.</p>
        )}
        <div className="mt-4">
          <Link href="/w" className="text-[14px] text-muted hover:text-foreground">Switch workspace</Link>
        </div>
      </Card>
    </main>
  );
}
