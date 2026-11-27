"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Loader2, Mail } from "lucide-react";
import { getInboundAddressAction, rotateInboundAddressAction } from "@/actions/reach.actions";
import { Button } from "@/components/ui/button";
import { Sheet } from "./sheet";

/** Email-to-task: a private address for the project; mail from workspace members becomes a task. */
export function EmailToTask({ organizationId, projectId, isAdmin, onClose }: { organizationId: string; projectId: string; isAdmin: boolean; onClose: () => void }) {
  const [s, setS] = useState<{ enabled: boolean; address: string | null; configured: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void getInboundAddressAction(organizationId, projectId).then((r) => (r.ok ? setS(r) : toast.error(r.message))), [organizationId, projectId]);
  const set = async (on: boolean) => {
    if (on && s?.enabled && !window.confirm("Make a new address? The current one stops working.")) return;
    setBusy(true);
    const r = await rotateInboundAddressAction(organizationId, projectId, on);
    setBusy(false);
    if (!r.ok) return void toast.error(r.message);
    setS(r);
  };
  return (
    <Sheet title={<span className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> Email to task</span>} onClose={onClose} side="center">
      <div className="space-y-4 p-5 text-[14.5px]">
        <p className="text-muted">Forward or send an email to this project&apos;s address and it becomes a task: the subject is the title, the message the description. Only email from people in this workspace is accepted, and the task is created as them.</p>
        {!s ? <Loader2 className="h-5 w-5 animate-spin text-subtle" /> : (
          <>
            {!s.configured && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">This server doesn&apos;t have an inbound email domain yet (INBOUND_EMAIL_DOMAIN and INBOUND_EMAIL_SECRET). You can turn it on now; the address appears once it&apos;s set up.</p>}
            {s.enabled && s.address && (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1.5">{s.address}</code>
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(s.address!).then(() => toast.success("Copied"))}><Copy className="h-4 w-4" /> Copy</Button>
              </div>
            )}
            {isAdmin ? (
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => set(true)}>{s.enabled ? "New address" : "Turn on"}</Button>
                {s.enabled && <Button variant="ghost" disabled={busy} onClick={() => set(false)}>Turn off</Button>}
              </div>
            ) : !s.enabled && <p className="text-subtle">Ask an admin to turn this on.</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
