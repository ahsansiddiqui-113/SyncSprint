"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { guestCommentAction } from "@/actions/guest.actions";
import { Button } from "@/components/ui/button";

export function GuestCommentForm({ organizationId, taskId }: { organizationId: string; taskId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-4 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        setBusy(true);
        const r = await guestCommentAction(organizationId, taskId, body);
        setBusy(false);
        if (!r.ok) return void toast.error(r.message);
        setBody("");
        router.refresh();
      }}
    >
      <textarea aria-label="Add a comment" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} rows={3} placeholder="Add a comment…" className="w-full rounded-lg border border-border px-3 py-2 text-[14.5px] outline-none focus:border-primary" />
      <Button size="sm" disabled={busy || !body.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Comment</Button>
    </form>
  );
}
