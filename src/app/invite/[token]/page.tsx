import Link from "next/link";
import { db } from "@/db";
import { getSession } from "@/lib/session";
import { getInvitePreview } from "@/server/services/workspace";
import { Card } from "@/components/ui/card";
import { RoleBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { AcceptInviteButton } from "@/components/workspace/accept-invite-button";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [preview, session] = await Promise.all([getInvitePreview(db, token), getSession()]);
  const valid = preview && preview.invite.status === "pending" && preview.invite.expiresAt.getTime() > Date.now();

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md p-6 text-center">
        {!valid ? (
          <>
            <h1 className="text-xl font-semibold">Invite unavailable</h1>
            <p className="mt-2 text-sm text-muted">This invite link is invalid, expired, revoked or already used.</p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">You have been invited to join</p>
            <h1 className="mt-1 text-2xl font-semibold">{preview.orgName}</h1>
            <div className="mt-2 flex items-center justify-center gap-2 text-sm">
              as <RoleBadge role={preview.invite.role} />
            </div>
            <p className="mt-2 text-xs text-muted">Invite for {preview.invite.email}</p>
            <div className="mt-6">
              {session ? (
                <AcceptInviteButton token={token} />
              ) : (
                <div className="flex justify-center gap-2">
                  <Link className={buttonVariants()} href={`/sign-up?next=/invite/${token}`}>Create account</Link>
                  <Link className={buttonVariants({ variant: "outline" })} href={`/sign-in?next=/invite/${token}`}>Sign in</Link>
                </div>
              )}
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
