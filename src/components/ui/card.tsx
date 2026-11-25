import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-border bg-card shadow-card", className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1.5 text-[14px] font-medium text-subtle">{eyebrow}</div>}
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-base text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-[18px] font-bold tracking-tight text-foreground", className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <defs>
          <linearGradient id="ss-a" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8930fd" />
            <stop offset="1" stopColor="#49ccf9" />
          </linearGradient>
          <linearGradient id="ss-b" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff02f0" />
            <stop offset="1" stopColor="#ffc800" />
          </linearGradient>
        </defs>
        <path d="M5 19.5l4-3.2c2.1 2.8 4.4 4.1 7 4.1s4.9-1.3 7-4.1l4 3.2c-3 4-6.6 6-11 6s-8-2-11-6z" fill="url(#ss-a)" />
        <path d="M16 11.4l-7.2 6.2-3.3-3.9L16 4.8l10.5 8.9-3.3 3.9z" fill="url(#ss-b)" />
      </svg>
      SyncSprint
    </span>
  );
}
