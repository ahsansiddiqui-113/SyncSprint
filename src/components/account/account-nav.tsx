"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/account/security", label: "Sign-in & security", icon: ShieldCheck },
  { href: "/account/notifications", label: "Notifications", icon: Bell },
  { href: "/account/calendar", label: "Calendar feed", icon: CalendarDays },
];

export function AccountNav() {
  const path = usePathname();
  return (
    <nav aria-label="Account" className="w-56 shrink-0">
      <h2 className="mb-3 px-3 text-[12.5px] font-semibold uppercase tracking-wide text-subtle">Your account</h2>
      <ul className="space-y-0.5">
        {ITEMS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={path === href ? "page" : undefined}
              className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14.5px] font-medium", path === href ? "bg-primary-soft text-primary" : "text-muted hover:bg-hover hover:text-foreground")}
            >
              <Icon className="h-4 w-4" /> {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
