import { cn } from "@/lib/utils";
import type { TaskPriority, OrgRole } from "@/db/schema";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[13px] font-medium leading-5", className)}
      {...props}
    />
  );
}

/* ------------------------------ priorities ------------------------------ */

/** ClickUp-style priority flags. */
export const PRIORITY_STYLE: Record<TaskPriority, { color: string; badge: string; bar: string; label: string }> = {
  urgent: { color: "#f50000", badge: "border-red-200 bg-red-50 text-red-600", bar: "bg-[#f50000]", label: "Urgent" },
  high: { color: "#ffcc00", badge: "border-amber-200 bg-amber-50 text-amber-700", bar: "bg-[#ffcc00]", label: "High" },
  medium: { color: "#6fddff", badge: "border-sky-200 bg-sky-50 text-sky-700", bar: "bg-[#6fddff]", label: "Normal" },
  low: { color: "#b4b9c1", badge: "border-zinc-200 bg-zinc-50 text-zinc-500", bar: "bg-[#b4b9c1]", label: "Low" },
};

export function PriorityFlag({ priority, className, size = 15 }: { priority: TaskPriority; className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={cn("shrink-0", className)} aria-label={`${PRIORITY_STYLE[priority].label} priority`}>
      <path d="M3 1.5v13" stroke={PRIORITY_STYLE[priority].color} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3.6 2.2h8.6l-2 3.3 2 3.3H3.6z" fill={PRIORITY_STYLE[priority].color} />
    </svg>
  );
}

/** Back-compat alias used across the board. */
export const PriorityIcon = PriorityFlag;

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[14px] text-muted">
      <PriorityFlag priority={priority} size={14} />
      {PRIORITY_STYLE[priority].label}
    </span>
  );
}

/* -------------------------------- statuses ------------------------------- */

const STATUS_COLORS = ["#87909e", "#7b68ee", "#ff9800", "#e44a8a", "#49ccf9"];
export const DONE_COLOR = "#2db87d";

/** Columns get a stable ClickUp-style status color by position (last column = done = green). */
export function statusColor(index: number, total: number) {
  if (index === total - 1) return DONE_COLOR;
  return STATUS_COLORS[index % STATUS_COLORS.length]!;
}

export function StatusPill({ title, color, count, className }: { title: string; color: string; count?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-semibold uppercase tracking-wide text-white"
        style={{ backgroundColor: color }}
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
          <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          {color === DONE_COLOR && (
            <path d="M3.8 6.1l1.5 1.5 2.9-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        {title}
      </span>
      {count !== undefined && <span className="text-[14px] font-medium text-subtle">{count}</span>}
    </span>
  );
}

/* ---------------------------------- roles --------------------------------- */

const ROLE: Record<OrgRole, string> = {
  owner: "border-violet-200 bg-violet-50 text-violet-700",
  admin: "border-indigo-200 bg-indigo-50 text-indigo-700",
  member: "border-emerald-200 bg-emerald-50 text-emerald-700",
  viewer: "border-zinc-200 bg-zinc-50 text-zinc-600",
};

export function RoleBadge({ role }: { role: OrgRole }) {
  return <Badge className={cn("capitalize", ROLE[role])}>{role}</Badge>;
}
