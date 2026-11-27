import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, organizations, users } from "@/db/schema";
import { requireUserOrRedirect } from "@/lib/session";
import { isGoogleEnabled, isMicrosoftEnabled } from "@/lib/auth";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { SecurityPanel } from "@/components/account/security-panel";

export const metadata = { title: "Sign-in & security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string; linked?: string; error?: string }> }) {
  const user = await requireUserOrRedirect("/account/security");
  const { required, linked: justLinked, error: linkError } = await searchParams;
  const [me] = await db.select({ twoFactorEnabled: users.twoFactorEnabled, isDemo: users.isDemo }).from(users).where(eq(users.id, user.id)).limit(1);
  const linked = await db.select({ providerId: accounts.providerId }).from(accounts).where(eq(accounts.userId, user.id));
  // Only name the workspace that sent them here (no lookup of workspaces they aren't in).
  const [requiredBy] = required
    ? await db.select({ name: organizations.name }).from(organizations).where(and(eq(organizations.slug, required), eq(organizations.require2fa, true))).limit(1)
    : [];
  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Your account", href: "/account" }, { label: "Sign-in & security" }]} />}
        title="Sign-in & security"
        description="Two-step sign-in and the devices signed in to your account."
      />
      <SecurityPanel
        enabled={!!me?.twoFactorEnabled}
        isDemo={!!me?.isDemo}
        hasPassword={linked.some((l) => l.providerId === "credential")}
        linked={linked.map((l) => l.providerId).filter((p) => p !== "credential")}
        requiredBy={requiredBy?.name ?? null}
        requiredSlug={requiredBy ? required! : null}
        available={[...(isGoogleEnabled ? ["google"] : []), ...(isMicrosoftEnabled ? ["microsoft"] : [])]}
        justLinked={justLinked ?? null}
        linkError={linkError ?? null}
      />
    </>
  );
}
