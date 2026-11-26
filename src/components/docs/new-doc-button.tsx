"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { createDocAction } from "@/actions/collab.actions";
import { Button } from "@/components/ui/button";

export function NewDocButton({ organizationId, orgSlug }: { organizationId: string; orgSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await createDocAction(organizationId, "Untitled doc");
          if (!r.ok) return void toast.error(r.message);
          router.push(`/w/${orgSlug}/docs/${r.id}?edit=1`);
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} New doc
    </Button>
  );
}
