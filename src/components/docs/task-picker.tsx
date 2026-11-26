"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Loader2, Search } from "lucide-react";
import { searchTasksAction } from "@/actions/collab.actions";
import { cn } from "@/lib/utils";

type Found = { id: string; title: string; ref: string };

/** Search tasks across the workspace by title or reference (ENG-12) and pick one. */
export function TaskPicker({
  organizationId,
  exclude = [],
  onPick,
  label = "Link task",
  className,
}: {
  organizationId: string;
  exclude?: string[];
  onPick: (t: Found) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const id = setTimeout(() => {
      searchTasksAction(organizationId, q).then((r) => {
        setLoading(false);
        if (r.ok) {
          setResults(r.tasks);
          setIndex(0);
        }
      });
    }, 180);
    return () => clearTimeout(id);
  }, [q, open, organizationId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const visible = results.filter((r) => !exclude.includes(r.id));
  const choose = (t: Found) => {
    onPick(t);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={box} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 text-[14px] font-medium text-muted transition hover:border-primary/50 hover:text-primary"
      >
        <Link2 className="h-3.5 w-3.5" /> {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-80 animate-fade-up rounded-xl border border-border bg-white p-1.5 shadow-lift">
          <div className="flex items-center gap-2 border-b border-border px-2 pb-1.5">
            <Search className="h-4 w-4 text-subtle" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(i + 1, visible.length - 1)));
                else if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(i - 1, 0)));
                else if (e.key === "Enter" && visible[index]) (e.preventDefault(), choose(visible[index]!));
                else if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search by title or ENG-12…"
              aria-label="Search tasks"
              className="h-9 flex-1 bg-transparent text-[15px] outline-none"
            />
            {loading && <Loader2 className="h-4 w-4 animate-spin text-subtle" />}
          </div>
          <div className="max-h-72 overflow-y-auto pt-1">
            {!loading && visible.length === 0 && <p className="px-3 py-3 text-[14px] text-subtle">No matching tasks</p>}
            {visible.map((t, i) => (
              <button
                key={t.id}
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(t)}
                className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14.5px]", i === index && "bg-primary-soft")}
              >
                <span className="shrink-0 font-mono text-[12.5px] text-subtle">{t.ref}</span>
                <span className="truncate">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
