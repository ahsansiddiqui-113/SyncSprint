"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";

export function ActivityFilters({
  members,
  actions,
  actor,
  action,
}: {
  members: { id: string; name: string }[];
  actions: string[];
  actor?: string;
  action?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.delete("before");
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next}`);
  }

  return (
    <div className="flex gap-2">
      <Select aria-label="Filter by actor" value={actor ?? ""} onChange={(e) => set("actor", e.target.value)} className="w-40">
        <option value="">All people</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </Select>
      <Select aria-label="Filter by action" value={action ?? ""} onChange={(e) => set("action", e.target.value)} className="w-48">
        <option value="">All actions</option>
        {actions.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </Select>
    </div>
  );
}
