"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, ArrowRight, Briefcase, CreditCard, FileText, FolderKanban, Goal, Home, Inbox, Link2, Lock, Plug, Search, SquareCheckBig, User, Users, UsersRound,
} from "lucide-react";
import { searchWorkspaceAction } from "@/actions/growth.actions";
import { cn } from "@/lib/utils";

/** Ctrl/Cmd+K: jump to any task (by title or ENG-12), project, doc, goal, person or page. */

export const OPEN_PALETTE = "syncsprint:open-palette";
type Item = { id: string; group: string; label: string; hint?: string; icon: typeof Home; href: string };

export function CommandPalette({ org, projects, admin }: { org: { id: string; slug: string }; projects: { key: string; name: string }[]; admin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const base = `/w/${org.slug}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE, onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setQ("");
      setResults([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const pages: Item[] = useMemo(() => [
    { id: "p-home", group: "Go to", label: "Home", icon: Home, href: base },
    { id: "p-inbox", group: "Go to", label: "Inbox", icon: Inbox, href: `${base}/inbox` },
    { id: "p-docs", group: "Go to", label: "Docs", icon: FileText, href: `${base}/docs` },
    { id: "p-portfolio", group: "Go to", label: "Portfolio", icon: Briefcase, href: `${base}/portfolio` },
    { id: "p-goals", group: "Go to", label: "Goals", icon: Goal, href: `${base}/goals` },
    { id: "p-groups", group: "Go to", label: "Groups", icon: UsersRound, href: `${base}/groups` },
    { id: "p-activity", group: "Go to", label: "Activity", icon: Activity, href: `${base}/activity` },
    { id: "p-members", group: "Settings", label: "Members", icon: Users, href: `${base}/settings/members` },
    ...(admin ? [
      { id: "p-billing", group: "Settings", label: "Billing & plan", icon: CreditCard, href: `${base}/settings/billing` },
      { id: "p-sharing", group: "Settings", label: "Share links", icon: Link2, href: `${base}/settings/sharing` },
      { id: "p-integrations", group: "Settings", label: "Integrations", icon: Plug, href: `${base}/settings/integrations` },
      { id: "p-security", group: "Settings", label: "Security", icon: Lock, href: `${base}/settings/security` },
    ] : []),
    { id: "p-account", group: "Settings", label: "Your account", icon: User, href: "/account/security" },
    ...projects.map((p) => ({ id: `proj-${p.key}`, group: "Projects", label: p.name, hint: p.key, icon: FolderKanban, href: `${base}/projects/${p.key}` })),
  ], [base, admin, projects]);

  // Debounced server search; pages/projects filter locally and instantly.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) return setResults([]);
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await searchWorkspaceAction(org.id, term);
      if (!live) return;
      setLoading(false);
      if (!r.ok) return setResults([]);
      setResults([
        ...r.tasks.map((t) => ({ id: `t-${t.id}`, group: "Tasks", label: t.title, hint: `${t.ref} · ${t.status}`, icon: SquareCheckBig, href: `${base}/projects/${t.key}?task=${t.id}` })),
        ...r.docs.map((d) => ({ id: `d-${d.id}`, group: "Docs", label: d.title, icon: FileText, href: `${base}/docs/${d.id}` })),
        ...r.goals.map((g) => ({ id: `g-${g.id}`, group: "Goals", label: g.title, icon: Goal, href: `${base}/goals` })),
        ...r.people.map((p) => ({ id: `u-${p.id}`, group: "People", label: p.name, hint: p.email, icon: User, href: `${base}/settings/members` })),
      ]);
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open, org.id, base]);

  const term = q.trim().toLowerCase();
  const local = pages.filter((p) => !term || p.label.toLowerCase().includes(term) || p.hint?.toLowerCase().includes(term));
  const items = [...results, ...local].slice(0, 40);
  const groups = [...new Set(items.map((i) => i.group))];
  const go = (it: Item | undefined) => {
    if (!it) return;
    setOpen(false);
    router.push(it.href);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Search and jump" className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-white shadow-lift" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-5 w-5 text-subtle" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => (setQ(e.target.value), setActive(0))}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(items.length - 1, a + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              else if (e.key === "Enter") (e.preventDefault(), go(items[active]));
            }}
            placeholder="Search tasks, ENG-12, docs, people, pages…"
            aria-label="Search"
            role="combobox"
            aria-expanded
            aria-controls="palette-list"
            className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-subtle"
          />
          {loading && <span className="text-[12px] text-subtle">Searching…</span>}
          <kbd className="rounded border border-border px-1.5 text-[11px] text-subtle">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-[14px] text-muted">{term.length >= 2 && !loading ? "Nothing matches." : "Type to search."}</li>}
          {groups.map((g) => (
            <li key={g}>
              <div className="px-3 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-subtle">{g}</div>
              <ul>
                {items.filter((i) => i.group === g).map((it) => {
                  const idx = items.indexOf(it);
                  const Icon = it.icon;
                  return (
                    <li key={it.id} role="option" aria-selected={idx === active}>
                      <button
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(it)}
                        className={cn("flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left", idx === active ? "bg-primary-soft text-primary" : "text-foreground")}
                      >
                        <Icon className="h-4 w-4 shrink-0 opacity-70" />
                        <span className="min-w-0 flex-1 truncate text-[14.5px]">{it.label}</span>
                        {it.hint && <span className="shrink-0 truncate text-[12.5px] text-subtle">{it.hint}</span>}
                        {idx === active && <ArrowRight className="h-4 w-4 shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <div className="flex gap-4 border-t border-border bg-surface-2/60 px-4 py-2 text-[12px] text-subtle">
          <span>↑↓ to move</span><span>Enter to open</span><span>Ctrl/⌘ K anywhere</span>
        </div>
      </div>
    </div>
  );
}
