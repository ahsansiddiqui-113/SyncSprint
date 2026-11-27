import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Logo } from "@/components/ui/card";
import { getSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/** Sticky marketing header shared by the landing, legal and roadmap pages. */
export async function SiteHeader() {
  const session = await getSession();
  return (
    <nav className="sticky top-0 z-30 border-b border-border/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-8 py-4">
        <Link href="/" aria-label="SyncSprint home">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/#features" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}>Features</Link>
          <Link href="/how-it-works" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}>How it works</Link>
          <Link href="/roadmap" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden md:inline-flex")}>Roadmap</Link>
          {session ? (
            <Link href="/w" className={buttonVariants({ size: "sm" })}>
              Open workspaces <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className={buttonVariants({ variant: "outline", size: "sm" })}>Log in</Link>
              <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>Sign up free</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

/** Consistent long-form page shell (legal, security, roadmap). */
export function DocPage({ eyebrow, title, updated, intro, children }: { eyebrow: string; title: string; updated?: string; intro?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-8 pb-24 pt-14">
      <header className="max-w-3xl">
        <p className="text-[14px] font-bold uppercase tracking-wider text-primary">{eyebrow}</p>
        <h1 className="mt-2 text-5xl font-extrabold tracking-tight">{title}</h1>
        {updated && <p className="mt-3 text-[15px] text-subtle">Last updated {updated}</p>}
        {intro && <p className="mt-5 text-[18px] leading-relaxed text-muted">{intro}</p>}
      </header>
      <div className="mt-12">{children}</div>
    </main>
  );
}

/** Two-column legal section: heading on the left, prose on the right. */
export function DocSection({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-24 gap-4 border-t border-border py-10 lg:grid-cols-[320px_1fr]">
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      <div className="max-w-3xl space-y-4 text-[16px] leading-relaxed text-muted [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}
