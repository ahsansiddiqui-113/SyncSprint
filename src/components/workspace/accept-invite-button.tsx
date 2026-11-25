"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { acceptInviteAction } from "@/actions/workspace.actions";
import { Button } from "@/components/ui/button";

export function AcceptInviteButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await acceptInviteAction(token);
          if (res && !res.ok) toast.error(res.message);
        })
      }
    >
      {pending ? "Joining…" : "Accept invite"}
    </Button>
  );
}
