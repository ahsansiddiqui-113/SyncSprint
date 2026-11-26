import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: React.ReactNode; href?: string };

/** "Acme › Settings › Billing". The last item is the current page and is never a link. */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-[14px] font-medium text-subtle", className)}>
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="inline-flex min-w-0 items-center gap-1">
              {c.href && !last ? (
                <Link href={c.href} className="truncate hover:text-foreground hover:underline">{c.label}</Link>
              ) : (
                <span className={cn("truncate", last && "text-foreground/80")} aria-current={last ? "page" : undefined}>{c.label}</span>
              )}
              {!last && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
