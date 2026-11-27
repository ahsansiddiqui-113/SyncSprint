"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Activity, Briefcase, Building2, ChevronsUpDown, CreditCard, FileText, Goal, Home, Inbox, Link2, Lock, LogOut, Plug, Plus, Search, Settings, ShieldCheck, Users, UsersRound } from "lucide-react";
import type { OrgRole } from "@/db/schema";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { isAdminRole } from "@/lib/rbac-shared";
import { switchDemoRoleAction } from "@/actions/demo.actions";
import { OPEN_PALETTE } from "./command-palette";
import { Avatar } from "@/components/ui/avatar";
import { RoleBadge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/card";
import { TimerPill, useUnreadCount } from "./live-widgets";

const ROLES: OrgRole[] = ["admin", "member", "viewer"];
const SPACE_COLORS = ["#7b68ee", "#ff9800", "#2db87d", "#e44a8a", "#49ccf9", "#f5a623"];

export function Sidebar({
  user,
  org,
  role,
  orgs,
  projects,
  platformAdmin = false,
}: {
  platformAdmin?: boolean;
  user: { id: string; name: string; email: string; image: string | null };
  org: { id: string; slug: string; name: string; isDemo: boolean };
  role: OrgRole;
  orgs: { slug: string; name: string }[];
  projects: { key: string; name: string; taskCount: number }[];
}) {
  const path = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  const base = `/w/${org.slug}`;
  const unread = useUnreadCount(org.id, user.id);

  // Guests only see the projects shared with them (everything else refuses them anyway).
  const guest = role === "guest";
  const nav = guest ? [{ href: `${base}/guest`, label: "Shared with you", icon: Home, active: path.endsWith("/guest"), badge: 0 }] : [
    { href: base, label: "Home", icon: Home, active: path === base },
    { href: `${base}/inbox`, label: "Inbox", icon: Inbox, active: path.endsWith("/inbox"), badge: unread },
    { href: `${base}/docs`, label: "Docs", icon: FileText, active: path.includes("/docs") },
    { href: `${base}/portfolio`, label: "Portfolio", icon: Briefcase, active: path.endsWith("/portfolio") },
    { href: `${base}/goals`, label: "Goals", icon: Goal, active: path.endsWith("/goals") },
    { href: `${base}/groups`, label: "Groups", icon: UsersRound, active: path.includes("/groups") },
    { href: `${base}/activity`, label: "Activity", icon: Activity, active: path.endsWith("/activity") },
  ];
  const admin = isAdminRole(role);
  const settings = guest ? [] : [
    { href: `${base}/settings/members`, label: "Members", icon: Users, active: path.endsWith("/settings/members") },
    ...(admin
      ? [
          { href: `${base}/settings/billing`, label: "Billing & plan", icon: CreditCard, active: path.endsWith("/settings/billing") },
          { href: `${base}/settings/sharing`, label: "Share links", icon: Link2, active: path.endsWith("/settings/sharing") },
          { href: `${base}/settings/integrations`, label: "Integrations", icon: Plug, active: path.endsWith("/settings/integrations") },
          { href: `${base}/settings/security`, label: "Security", icon: Lock, active: path.endsWith("/settings/security") },
        ]
      : []),
  ];

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
      {/* Workspace switcher */}
      <div className="border-b border-border p-3">
        <label className="relative flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-hover">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-[#8930fd] to-[#49ccf9] text-[15px] font-bold text-white">
            {org.name[0]}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{org.name}</span>
            <span className="block text-[13px] text-subtle">{org.isDemo ? "Demo workspace" : "Workspace"}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-subtle" />
          <select
            aria-label="Switch workspace"
            value={org.slug}
            onChange={(e) => router.push(e.target.value === "__all" ? "/w" : `/w/${e.target.value}`)}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {orgs.map((o) => (
              <option key={o.slug} value={o.slug}>{o.name}</option>
            ))}
            <option value="__all">All workspaces…</option>
          </select>
        </label>
      </div>

      <TimerPill org={org} />

      <div className={cn("px-3 pt-3", guest && "hidden")}>
        <button
          onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-[14px] text-subtle transition-colors hover:border-border-strong hover:text-foreground"
        >
          <Search className="h-4 w-4" /> <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded border border-border px-1 text-[11px]">Ctrl K</kbd>
        </button>
      </div>

      <nav className="space-y-0.5 px-3 pt-3">
        {nav.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-1.5 text-[15px] font-medium text-muted transition-colors hover:bg-hover hover:text-foreground",
              i.active && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary"
            )}
          >
            <i.icon className="h-[18px] w-[18px]" />
            <span className="flex-1">{i.label}</span>
            {"badge" in i && !!i.badge && (
              <span className="min-w-6 rounded-full bg-primary px-1.5 py-0.5 text-center text-[12px] font-semibold leading-none text-white" aria-label={`${i.badge} unread`}>
                {i.badge > 99 ? "99+" : i.badge}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <nav aria-label="Workspace settings" className="mt-3 space-y-0.5 px-3">
        {settings.length > 0 && <div className="px-3 pb-1 text-[13px] font-semibold text-subtle">Workspace</div>}
        {settings.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-1.5 text-[14.5px] font-medium text-muted transition-colors hover:bg-hover hover:text-foreground",
              i.active && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary"
            )}
          >
            <i.icon className="h-[17px] w-[17px]" />
            {i.label}
          </Link>
        ))}
        {platformAdmin && (
          <Link href="/platform" className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-[14.5px] font-medium text-primary transition-colors hover:bg-primary-soft">
            <Building2 className="h-[17px] w-[17px]" /> SyncSprint console
          </Link>
        )}
      </nav>

      <div className="mt-5 flex-1 overflow-y-auto px-3">
        <div className="mb-1 flex items-center justify-between px-3 text-[13px] font-semibold text-subtle">
          Spaces
          {!guest && (
            <Link href={base} title="New project" className="rounded p-0.5 hover:bg-hover hover:text-foreground">
              <Plus className="h-4 w-4" />
            </Link>
          )}
        </div>
        <div className="space-y-0.5">
          {projects.map((p, i) => {
            const href = guest ? `${base}/guest/${p.key}` : `${base}/projects/${p.key}`;
            const active = path === href;
            const color = SPACE_COLORS[i % SPACE_COLORS.length];
            return (
              <Link
                key={p.key}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] text-foreground transition-colors hover:bg-hover",
                  active && "bg-primary-soft font-semibold text-primary hover:bg-primary-soft"
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white" style={{ backgroundColor: color }}>
                  {p.name[0]}
                </span>
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-[13px] text-subtle">{p.taskCount}</span>
              </Link>
            );
          })}
          {projects.length === 0 && <p className="px-3 text-[14px] text-subtle">No projects yet</p>}
        </div>
      </div>

      <div className="space-y-3 border-t border-border p-3">
        {org.isDemo && (
          <div className="rounded-xl border border-primary/20 bg-primary-soft/70 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-primary">
              <ShieldCheck className="h-4 w-4" /> Demo · act as role
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-white p-1 shadow-card">
              {ROLES.map((r) => (
                <button
                  key={r}
                  disabled={pending || r === role}
                  onClick={() =>
                    start(async () => {
                      const res = await switchDemoRoleAction(org.id, r);
                      if (!res.ok) return void toast.error(res.message);
                      toast.success(`You are now ${r}`, { description: "Permissions updated." });
                      router.refresh();
                    })
                  }
                  className={cn(
                    "cursor-pointer rounded-md py-1.5 text-[13px] font-medium capitalize transition-colors disabled:cursor-default",
                    r === role ? "bg-primary text-white shadow" : "text-muted hover:bg-hover hover:text-foreground"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-muted">Preview what each role can see and do in this workspace.</p>
          </div>
        )}

        <div className="flex items-center gap-3 rounded-lg px-1.5 py-1">
          <Avatar id={user.id} name={user.name} src={user.image} size={34} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold">{user.name}</span>
              <RoleBadge role={role} />
            </div>
            <div className="truncate text-[13px] text-subtle">{user.email}</div>
          </div>
          <Link href="/account/security" title="Your account: sign-in, security, notifications" aria-label="Account settings" className="rounded-md p-1.5 text-subtle transition-colors hover:bg-hover hover:text-foreground">
            <Settings className="h-4 w-4" />
          </Link>
          <button
            title="Sign out"
            className="cursor-pointer rounded-md p-1.5 text-subtle transition-colors hover:bg-hover hover:text-foreground"
            onClick={async () => {
              await authClient.signOut();
              router.push("/");
              router.refresh();
            }}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <Link href="/" className="block px-2 pt-1"><Logo className="text-[15px] [&_svg]:h-6 [&_svg]:w-6" /></Link>
      </div>
    </aside>
  );
}
