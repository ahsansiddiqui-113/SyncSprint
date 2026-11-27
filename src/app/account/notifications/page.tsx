import { requireUserOrRedirect } from "@/lib/session";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { NotificationSettings } from "@/components/account/notification-settings";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireUserOrRedirect("/account/notifications");
  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Your account", href: "/account" }, { label: "Notifications" }]} />}
        title="Notifications"
        description="Your inbox always has everything. Choose what also reaches you by push, email and WhatsApp, per workspace."
      />
      <NotificationSettings showOutbox={process.env.NODE_ENV !== "production"} />
    </>
  );
}
