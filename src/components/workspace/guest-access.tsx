"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, UserRoundCheck } from "lucide-react";
import { listGuestAccessAction, setGuestProjectAction } from "@/actions/guest.actions";
import { Card } from "@/components/ui/card";

type Guest = Extract<Awaited<ReturnType<typeof listGuestAccessAction>>, { ok: true }>["guests"][number];

/** Admins choose which projects each guest can see. Guests are free and see nothing else. */
export function GuestAccess({ organizationId, projects }: { organizationId: string; projects: { id: string; key: string; name: string }[] }) {
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const load = useCallback(async () => {
    const r = await listGuestAccessAction(organizationId);
    if (!r.ok) return void toast.error(r.message);
    setGuests(r.guests);
  }, [organizationId]);
  useEffect(() => void load(), [load]);

  return (
    <Card className="mt-6 p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold"><UserRoundCheck className="h-5 w-5 text-primary" /> Guest access</h2>
      <p className="mt-1 max-w-3xl text-[14.5px] text-muted">
        Guests (clients, contractors) are free. They see only the projects you tick here, can comment on tasks, and nothing else in the workspace. Invite someone with the <b>Guest</b> role to add one.
      </p>
      {guests === null ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-subtle" /> : guests.length === 0 ? (
        <p className="mt-4 text-[14px] text-subtle">No guests yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-[14px]">
            <thead className="text-[12.5px] uppercase tracking-wide text-subtle">
              <tr><th className="py-2 pr-4">Guest</th>{projects.map((p) => <th key={p.id} className="px-2 py-2 text-center" title={p.name}>{p.key}</th>)}</tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.userId} className="border-t border-border">
                  <td className="py-2 pr-4"><div className="font-medium">{g.name}</div><div className="text-[12.5px] text-subtle">{g.email}</div></td>
                  {projects.map((p) => {
                    const on = g.projectIds.includes(p.id);
                    return (
                      <td key={p.id} className="px-2 py-2 text-center">
                        <input type="checkbox" aria-label={`${g.name} can see ${p.name}`} checked={on} onChange={async (e) => {
                          const r = await setGuestProjectAction(organizationId, g.userId, p.id, e.target.checked);
                          if (!r.ok) return void toast.error(r.message);
                          void load();
                        }} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
