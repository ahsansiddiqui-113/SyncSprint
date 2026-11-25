import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function timeAgo(date: Date | string, now = Date.now()) {
  const s = Math.max(1, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Deterministic avatar color per user id. */
export function avatarColor(id: string) {
  const palette = [
    "bg-linear-to-br from-sky-400 to-blue-600",
    "bg-linear-to-br from-violet-400 to-purple-600",
    "bg-linear-to-br from-emerald-400 to-teal-600",
    "bg-linear-to-br from-amber-400 to-orange-600",
    "bg-linear-to-br from-rose-400 to-pink-600",
    "bg-linear-to-br from-indigo-400 to-indigo-700",
    "bg-linear-to-br from-cyan-400 to-sky-700",
  ];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length]!;
}
