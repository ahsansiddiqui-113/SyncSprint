"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { OrgRole } from "@/db/schema";
import { changeMemberRoleAction, removeMemberAction } from "@/actions/workspace.actions";
import { Avatar } from "@/components/ui/avatar";
import { RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { hasRole } from "@/lib/rbac-shared";

type Member = { userId: string; name: string; email: string; avatarUrl: string | null; role: OrgRole; joinedAt: string };

export function MembersTable({
  organizationId,
  currentUserId,
  actorRole,
  members,
}: {
  organizationId: string;
  currentUserId: string;
  actorRole: OrgRole;
  members: Member[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isAdmin = hasRole(actorRole, "admin");

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.message ?? "Failed");
      toast.success(success);
      router.refresh();
    });

  return (
    <div className="divide-y divide-border">
      {members.map((m) => {
        // UI mirrors the server rules for clarity; the server re-validates everything.
        const editable = isAdmin;
        return (
          <div key={m.userId} className="flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-surface-2">
            <Avatar id={m.userId} name={m.name} src={m.avatarUrl} size={34} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {m.name} {m.userId === currentUserId && <span className="text-muted">(you)</span>}
              </div>
              <div className="truncate text-xs text-muted">{m.email}</div>
            </div>
            {editable ? (
              <Select
                aria-label={`Role for ${m.name}`}
                className="h-8 w-28"
                value={m.role}
                disabled={pending}
                onChange={(e) =>
                  run(() => changeMemberRoleAction(organizationId, m.userId, e.target.value as OrgRole), `${m.name} is now ${e.target.value}`)
                }
              >
                {(["admin", "member", "viewer"] as const)
                  .map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
              </Select>
            ) : (
              <RoleBadge role={m.role} />
            )}
            {(editable || m.userId === currentUserId) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(() => removeMemberAction(organizationId, m.userId), m.userId === currentUserId ? "You left the workspace" : `${m.name} removed`)}
              >
                {m.userId === currentUserId ? "Leave" : "Remove"}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
