import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { db } from "@/db";
import { requireUserOrRedirect } from "@/lib/session";
import { listMyOrganizations } from "@/server/services/workspace";
import { Card } from "@/components/ui/card";
import { RoleBadge, Badge } from "@/components/ui/badge";
import { CreateOrgForm } from "@/components/workspace/create-org-form";
import { SignOutButton } from "@/components/workspace/sign-out-button";
import { DemoButton } from "@/components/auth/demo-button";

export default async function WorkspacesPage() {
  const user = await requireUserOrRedirect("/w");
  const orgs = await listMyOrganizations(db, user.id);

  return (
    <main className="mx-auto w-full max-w-5xl px-8 py-14">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Your workspaces</h1>
          <p className="text-sm text-muted">Signed in as {user.name}</p>
        </div>
        <SignOutButton />
      </div>

      <div className="space-y-2">
        {orgs.length === 0 && <p className="text-sm text-muted">You are not a member of any workspace yet.</p>}
        {orgs.map((o) => (
          <Link key={o.id} href={`/w/${o.slug}`}>
            <Card className="flex items-center justify-between p-4 transition-colors hover:bg-foreground/[0.03]">
              <div className="flex items-center gap-2">
                <span className="font-medium">{o.name}</span>
                <RoleBadge role={o.role} />
                {o.isDemo && <Badge className="bg-amber-500/15 text-amber-700">demo</Badge>}
              </div>
              <ArrowRight className="h-4 w-4 text-muted" />
            </Card>
          </Link>
        ))}
      </div>

      <Card className="mt-8 p-5">
        <h2 className="mb-3 font-semibold">Create a workspace</h2>
        <CreateOrgForm />
      </Card>
      <div className="mt-6 text-center">
        <DemoButton size="md" />
      </div>
    </main>
  );
}
