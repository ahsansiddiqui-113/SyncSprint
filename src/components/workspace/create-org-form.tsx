"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { createOrganizationAction } from "@/actions/workspace.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateOrgForm() {
  const [pending, start] = useTransition();
  return (
    <form
      className="flex gap-2"
      action={(fd) =>
        start(async () => {
          const res = await createOrganizationAction(String(fd.get("name")));
          if (res && !res.ok) toast.error(res.message);
        })
      }
    >
      <Input name="name" placeholder="e.g. Acme Inc." aria-label="Workspace name" required minLength={2} maxLength={120} />
      <Button disabled={pending}>{pending ? "Creating…" : "Create"}</Button>
    </form>
  );
}
