"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { createProjectAction } from "@/actions/workspace.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateProjectForm({ organizationId, orgSlug }: { organizationId: string; orgSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_120px_auto]"
      action={(fd) =>
        start(async () => {
          const res = await createProjectAction({
            organizationId,
            name: String(fd.get("name")),
            key: String(fd.get("key")),
            description: String(fd.get("description") || "") || undefined,
          });
          if (!res.ok) return void toast.error(res.message);
          router.push(`/w/${orgSlug}/projects/${res.key}`);
        })
      }
    >
      <Input name="name" placeholder="Project name" required minLength={2} />
      <Input name="key" placeholder="KEY" required pattern="[A-Za-z][A-Za-z0-9]{1,9}" className="uppercase" />
      <Button disabled={pending}>{pending ? "Creating…" : "Create"}</Button>
      <Input name="description" placeholder="Description (optional)" className="sm:col-span-3" />
    </form>
  );
}
