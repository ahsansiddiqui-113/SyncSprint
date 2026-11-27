import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card, Logo } from "@/components/ui/card";
import { currentRequestIp } from "@/lib/request-ip";

export const metadata = { title: "Not available from this network" };
export const dynamic = "force-dynamic";

export default async function BlockedPage() {
  const ip = await currentRequestIp();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-canvas px-6">
      <Link href="/"><Logo /></Link>
      <Card className="max-w-md p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-amber-600" />
        <h1 className="mt-3 text-2xl font-bold tracking-tight">Not available from this network</h1>
        <p className="mt-2 text-[15px] text-muted">
          This workspace can only be opened from your company&apos;s approved networks (office or VPN). Connect to one and try again, or ask an admin to add your address.
        </p>
        {ip && <p className="mt-4 text-[14px] text-subtle">Your address: <code className="rounded bg-surface-2 px-1.5">{ip}</code></p>}
        <Link href="/w" className="mt-6 inline-block text-[15px] font-medium text-primary hover:underline">Back to your workspaces</Link>
      </Card>
    </main>
  );
}
