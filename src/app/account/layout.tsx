import Link from "next/link";
import { requireUserOrRedirect } from "@/lib/session";
import { Logo } from "@/components/ui/card";
import { SignOutButton } from "@/components/workspace/sign-out-button";
import { AccountNav } from "@/components/account/account-nav";

export const metadata = { title: "Account" };

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requireUserOrRedirect("/account");
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-20 border-b border-border bg-white/90 backdrop-blur">
        <div className="flex h-16 w-full items-center gap-4 px-8 2xl:px-14">
          <Link href="/w"><Logo /></Link>
          <Link href="/w" className="ml-6 text-[14.5px] font-medium text-muted hover:text-foreground">← Your workspaces</Link>
          <div className="ml-auto"><SignOutButton /></div>
        </div>
      </header>
      <div className="flex w-full flex-1 gap-10 px-10 py-10 2xl:px-14">
        <AccountNav />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
