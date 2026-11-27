"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { AlarmClock, Loader2, X } from "lucide-react";
import { deleteReminderAction, listRemindersAction, setReminderAction } from "@/actions/board-power.actions";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatDateTimeUtc } from "@/lib/utils";

type Row = { id: string; remindAt: string; note: string | null; sentAt: string | null };

const at = (days: number, hour: number, from = new Date()) => {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};
function presets(now = new Date()) {
  const inHour = new Date(now.getTime() + 3_600_000);
  const tomorrow9 = at(1, 9, now);
  const monday = at(((8 - now.getDay()) % 7) || 7, 9, now);
  return [
    { label: "In 1 hour", when: inHour },
    { label: "Later today (17:00)", when: at(0, 17, now) },
    { label: "Tomorrow 09:00", when: tomorrow9 },
    { label: "Next Monday 09:00", when: monday },
  ].filter((p) => p.when.getTime() > now.getTime() + 60_000);
}
const local = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Personal reminders on a task: arrive in your inbox (and by push/email if you've turned those on). */
export function RemindMe({ organizationId, taskId }: { organizationId: string; taskId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await listRemindersAction(organizationId, taskId);
    setRows(r.ok ? r.reminders : []);
  }, [organizationId, taskId]);

  async function add(when: Date) {
    setBusy(true);
    const r = await setReminderAction(organizationId, taskId, when.toISOString(), null);
    setBusy(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success(`I'll remind you ${local(r.reminder.remindAt)}`);
    void load();
  }
  const upcoming = rows?.filter((r) => !r.sentAt) ?? [];

  return (
    <Popover
      onOpenChange={(open) => open && void load()}
      trigger={() => (
        <Button variant="ghost" size="sm" title="Remind me about this task">
          <AlarmClock className="h-3.5 w-3.5" /> Remind me{upcoming.length ? ` (${upcoming.length})` : ""}
        </Button>
      )}
    >
      <div className="w-72 space-y-1">
        {presets().map((p) => (
          <button key={p.label} disabled={busy} onClick={() => add(p.when)} className="flex w-full cursor-pointer justify-between rounded-lg px-3 py-2 text-left text-[14.5px] hover:bg-hover">
            <span>{p.label}</span><span className="text-[12.5px] text-subtle">{local(p.when.toISOString())}</span>
          </button>
        ))}
        <form className="flex gap-2 px-2 pb-1 pt-1" onSubmit={(e) => { e.preventDefault(); if (custom) void add(new Date(custom)); }}>
          <input type="datetime-local" aria-label="Pick a date and time" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-border px-2 text-[13.5px]" />
          <Button size="sm" disabled={!custom || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set"}</Button>
        </form>
        {upcoming.length > 0 && (
          <div className="border-t border-border pt-1">
            <div className="px-3 py-1 text-[12px] font-semibold uppercase tracking-wide text-subtle">Upcoming</div>
            {upcoming.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3 py-1 text-[14px]" title={formatDateTimeUtc(r.remindAt)}>
                <AlarmClock className="h-3.5 w-3.5 text-subtle" /> <span className="flex-1">{local(r.remindAt)}</span>
                <button aria-label="Cancel reminder" onClick={async () => {
                  const d = await deleteReminderAction(organizationId, r.id);
                  if (!d.ok) return void toast.error(d.message);
                  void load();
                }} className="cursor-pointer rounded p-1 text-subtle hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
}
