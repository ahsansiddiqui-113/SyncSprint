"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import type { OrgRole } from "@/db/schema";
import { createInviteAction, revokeInviteAction } from "@/actions/workspace.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { RoleBadge } from "@/components/ui/badge";

type Invite = { id: string; email: string; role: OrgRole; token: string; expiresAt: string };

export function InvitePanel({ organizationId, actorRole, invites }: { organizationId: string; actorRole: OrgRole; invites: Invite[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const linkFor = (token: string) => `${window.location.origin}/invite/${token}`;

  return (
    <Card className="mt-8 p-6">
      <h2 className="font-semibold tracking-tight">Invite people</h2>
      <p className="mb-4 mt-1 text-sm text-muted">Generates a single-use link bound to the invitee&apos;s email.</p>
      <form
        className="flex flex-wrap gap-2"
        action={(fd) =>
          start(async () => {
            const res = await createInviteAction(organizationId, String(fd.get("email")), fd.get("role") as OrgRole);
            if (!res.ok) return void toast.error(res.message);
            await navigator.clipboard?.writeText(linkFor(res.token)).catch(() => {});
            toast.success("Invite link created and copied to clipboard");
            router.refresh();
          })
        }
      >
        <Input name="email" type="email" required placeholder="teammate@company.com" className="min-w-56 flex-1" />
        <Select name="role" defaultValue="member" className="w-28">
          {(["admin", "member", "viewer", "guest"] as const).map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </Select>
        <Button disabled={pending}>Create link</Button>
      </form>
      <p className="mt-2 text-xs text-muted">Links are single-use, expire in 7 days and only work for the invited email address.</p>

      {invites.length > 0 && (
        <div className="mt-5 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-2">
          {invites.map((i) => (
            <div key={i.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{i.email}</span>
              <RoleBadge role={i.role} />
              <Button
                variant="ghost"
                size="icon"
                title="Copy invite link"
                onClick={async () => {
                  await navigator.clipboard.writeText(linkFor(i.token));
                  toast.success("Copied");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await revokeInviteAction(organizationId, i.id);
                    if (!res.ok) return void toast.error(res.message);
                    router.refresh();
                  })
                }
              >
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
