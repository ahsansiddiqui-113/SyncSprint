"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { calendarFeedStatusAction, revokeCalendarFeedAction, rotateCalendarFeedAction } from "@/actions/reach.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function CalendarFeed({ baseUrl }: { baseUrl: string }) {
  const [active, setActive] = useState<boolean | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => void calendarFeedStatusAction().then((r) => setActive(r.ok ? r.active : false)), []);

  async function make() {
    if (active && !window.confirm("Make a new link? Calendars using the current link will stop updating.")) return;
    const r = await rotateCalendarFeedAction();
    if (!r.ok) return void toast.error(r.message);
    setUrl(`${baseUrl}/api/calendar/${r.token}.ics`);
    setActive(true);
  }

  return (
    <Card className="p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold"><CalendarDays className="h-5 w-5 text-primary" /> Your private calendar link</h2>
      <p className="mt-1 max-w-2xl text-[14.5px] text-muted">
        Anyone with the link can see your due dates, so keep it to yourself. The link is shown only once; make a new one any time (the old one stops working).
      </p>
      {active === null ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-subtle" /> : (
        <div className="mt-4 space-y-3">
          {url && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1.5 text-[13px]">{url}</code>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Copied"))}><Copy className="h-4 w-4" /> Copy</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={make}>{active ? <><RefreshCw className="h-4 w-4" /> Make a new link</> : "Create my calendar link"}</Button>
            {active && (
              <Button variant="ghost" onClick={async () => {
                const r = await revokeCalendarFeedAction();
                if (!r.ok) return void toast.error(r.message);
                setActive(false);
                setUrl(null);
              }}><Trash2 className="h-4 w-4" /> Turn off</Button>
            )}
          </div>
          <ul className="list-disc space-y-1 pl-5 text-[14px] text-muted">
            <li><b>Google Calendar:</b> Other calendars › + › From URL, paste the link.</li>
            <li><b>Outlook:</b> Add calendar › Subscribe from web, paste the link.</li>
            <li><b>Apple Calendar:</b> File › New Calendar Subscription, paste the link.</li>
          </ul>
        </div>
      )}
    </Card>
  );
}
