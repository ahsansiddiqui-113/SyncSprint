import Link from "next/link";
import { Logo } from "@/components/ui/card";

type FooterLink = { label: string; href: string };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Boards & lists", href: "/#feature-boards" },
      { label: "Calendar", href: "/#feature-calendar" },
      { label: "Timeline", href: "/#feature-timeline" },
      { label: "Dashboards", href: "/#feature-dashboards" },
      { label: "Subtasks & checklists", href: "/#feature-breakdown" },
      { label: "AI assistant", href: "/#feature-ai" },
    ],
  },
  {
    title: "Get started",
    links: [
      { label: "Live demo", href: "/#demo" },
      { label: "Create a workspace", href: "/sign-up" },
      { label: "Log in", href: "/sign-in" },
      { label: "How it works", href: "/how-it-works" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Product roadmap", href: "/roadmap" },
      { label: "Security", href: "/security" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms of service", href: "/terms" },
    ],
  },
];

/** Site-wide marketing footer (landing, legal and roadmap pages). */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-[#16171d] text-white">
      <div className="mx-auto max-w-[1440px] px-8 pb-10 pt-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-sm">
            <Logo className="text-white" />
            <p className="mt-4 text-[15px] leading-relaxed text-white/60">
              Plan, track and ship work together. Boards, lists, calendars, timelines and dashboards — always in sync.
            </p>
            <Link
              href="/sign-up"
              className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-[15px] font-medium text-white transition-colors hover:bg-primary-dark"
            >
              Get started free
            </Link>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="text-[13px] font-semibold uppercase tracking-wider text-white/45">{col.title}</h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-[15px] text-white/75 transition-colors hover:text-white">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-6 text-[14px] text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} SyncSprint. All rights reserved.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
            <Link href="/security" className="hover:text-white">Security</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
