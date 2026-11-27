import { requireUserOrRedirect } from "@/lib/session";
import { appBaseUrl } from "@/lib/base-url";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { CalendarFeed } from "@/components/account/calendar-feed";

export const metadata = { title: "Calendar feed" };

export default async function CalendarPage() {
  await requireUserOrRedirect("/account/calendar");
  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Your account", href: "/account" }, { label: "Calendar feed" }]} />}
        title="Calendar feed"
        description="See the due dates of work assigned to you, and time off, in Google Calendar, Outlook or Apple Calendar. It updates by itself."
      />
      <CalendarFeed baseUrl={appBaseUrl()} />
    </>
  );
}
