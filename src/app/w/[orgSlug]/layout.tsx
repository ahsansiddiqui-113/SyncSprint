import Link from "next/link";
import { AlertTriangle, Clock, Lock, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { isPlatformAdmin } from "@/lib/platform";
import { isAdminRole } from "@/lib/rbac-shared";
import { cn } from "@/lib/utils";
import { loadWorkspaceAnyState } from "@/server/page-guards";
import { listMyOrganizations, listProjects } from "@/server/services/workspace";
import { guestProjects } from "@/server/services/guests";
import { Sidebar } from "@/components/workspace/sidebar";
import { CommandPalette } from "@/components/workspace/command-palette";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { user, org, role, billing, viaSupport } = await loadWorkspaceAnyState(orgSlug);
  const guest = role === "guest";
  const [orgs, projects] = await Promise.all([
    listMyOrganizations(db, user.id),
    guest ? guestProjects(db, user.id, org.id).then((ps) => ps.map((p) => ({ ...p, taskCount: 0 }))) : listProjects(db, user.id, orgSlug).then((r) => r.projects),
  ]);
  const admin = isAdminRole(role) && !viaSupport;
  const tone = billing.access === "full" ? "amber" : "rose";

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        user={{ id: user.id, name: user.name, email: user.email, image: user.image ?? null }}
        org={{ id: org.id, slug: org.slug, name: org.name, isDemo: org.isDemo }}
        role={role}
        orgs={orgs.map((o) => ({ slug: o.slug, name: o.name }))}
        projects={projects.map((p) => ({ key: p.key, name: p.name, taskCount: p.taskCount }))}
        platformAdmin={isPlatformAdmin(user)}
      />
      <div className="relative flex min-w-0 flex-1 flex-col">
        {viaSupport && (
          <div className="flex items-center gap-2 border-b border-sky-200 bg-sky-50 px-6 py-2 text-[14px] text-sky-900">
            <ShieldCheck className="h-4 w-4 shrink-0" /> Support view: read-only access granted by this company&apos;s admin. Everything you open is recorded in their activity log.
          </div>
        )}
        {billing.message && billing.access !== "locked" && (
          <div
            role="status"
            className={cn(
              "flex flex-wrap items-center gap-2 border-b px-6 py-2 text-[14px]",
              tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-rose-200 bg-rose-50 text-rose-900"
            )}
          >
            {billing.access === "read_only" ? <Lock className="h-4 w-4 shrink-0" /> : billing.phase === "trial" ? <Clock className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">
              {billing.message}
              {billing.access === "read_only" && " You can still view and export everything."}
            </span>
            {admin ? (
              <Link href={`/w/${org.slug}/settings/billing`} className="font-semibold underline underline-offset-2">
                {billing.phase === "trial" ? "Choose a plan" : "Go to billing"}
              </Link>
            ) : (
              <span className="text-[13px] opacity-80">Your workspace admin can resolve this.</span>
            )}
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-y-auto">{children}</div>
        {!guest && <CommandPalette org={{ id: org.id, slug: org.slug }} projects={projects.map((p) => ({ key: p.key, name: p.name }))} admin={admin} />}
      </div>
    </div>
  );
}
