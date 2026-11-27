"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, FileJson, Globe, History, Loader2, ShieldCheck } from "lucide-react";
import { getSecurityAction, setAuditRetentionAction, setIpAllowlistAction, setRequire2faAction } from "@/actions/security.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { RoleBadge } from "@/components/ui/badge";
import { SsoSettings } from "./sso-settings";

type Settings = Extract<Awaited<ReturnType<typeof getSecurityAction>>, { ok: true }>["settings"];

export function SecuritySettings({ org, baseUrl }: { org: { id: string; slug: string; name: string; isDemo: boolean }; baseUrl: string }) {
  const [s, setS] = useState<Settings | null>(null);
  const [myIp, setMyIp] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await getSecurityAction(org.id);
    if (!r.ok) return void toast.error(r.message);
    setS(r.settings);
    setMyIp(r.myIp);
  }, [org.id]);
  useEffect(() => void load(), [load]);

  if (!s) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-subtle" /></div>;

  return (
    <div className="space-y-6">
      {org.isDemo && <Card className="border-amber-200 bg-amber-50 p-4 text-[14.5px] text-amber-900">This is the demo workspace: sign-in rules and IP limits are saved but not enforced here.</Card>}

      <Section icon={ShieldCheck} title="Require two-step sign-in" text="Everyone (admins included) must have two-step sign-in on to open this workspace. People without it are sent to set it up.">
        <div className="flex flex-wrap items-center gap-3">
          <Toggle
            on={s.require2fa}
            label="Require two-step sign-in"
            onChange={async (on) => {
              const r = await setRequire2faAction(org.id, on);
              if (!r.ok) return void toast.error(r.message);
              toast.success(on ? "Two-step sign-in is now required" : "Two-step sign-in is optional again");
              void load();
            }}
          />
          <Link href="/account/security" className="text-[14px] text-primary hover:underline">Your own two-step sign-in</Link>
        </div>
        {s.without2fa.length > 0 && (
          <div className="mt-4">
            <p className="text-[14px] font-medium">{s.without2fa.length} of {s.members} people don&apos;t have it on yet{s.require2fa ? " and can't get in until they do" : ""}:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {s.without2fa.slice(0, 30).map((p) => (
                <li key={p.userId} className="flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[13px]">
                  {p.name} <RoleBadge role={p.role} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <IpSection orgId={org.id} initial={s.ipAllowlist} myIp={myIp} onSaved={load} />

      <SsoSettings org={org} baseUrl={baseUrl} ssoRequired={s.ssoRequired} scimEnabled={s.scimEnabled} onChanged={load} />

      <Section icon={History} title="Audit log" text="Every change in the workspace is recorded. Download it for your records, or delete old entries automatically.">
        <AuditExport orgId={org.id} />
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = String(new FormData(e.currentTarget).get("days"));
            const r = await setAuditRetentionAction(org.id, v === "forever" ? null : Number(v));
            if (!r.ok) return void toast.error(r.message);
            toast.success("Retention saved");
            void load();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="retention">Keep entries for</Label>
            <select id="retention" name="days" defaultValue={s.auditRetentionDays ?? "forever"} className="h-10 rounded-lg border border-border bg-white px-3 text-[14.5px]">
              <option value="forever">Forever</option>
              {[90, 180, 365, 730, 1095, 2555].map((d) => <option key={d} value={d}>{d < 365 ? `${d} days` : `${d / 365} year${d === 365 ? "" : "s"}`}</option>)}
            </select>
          </div>
          <Button variant="outline">Save</Button>
        </form>
      </Section>

      <Section icon={FileJson} title="Export the whole workspace" text="Projects, statuses, tasks, comments, docs, goals, sprints, time, automations, whiteboards and more, as one JSON file. Secrets and file contents are left out. You can do this any time, including while the workspace is read-only.">
        <a href={`/api/export/workspace?org=${org.id}`} download>
          <Button variant="outline"><Download className="h-4 w-4" /> Download export (.json)</Button>
        </a>
      </Section>
    </div>
  );
}

export function Section({ icon: Icon, title, text, children }: { icon: typeof ShieldCheck; title: string; text: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Icon className="h-5 w-5 text-primary" /> {title}</h2>
      <p className="mt-1 max-w-3xl text-[14.5px] text-muted">{text}</p>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

export function Toggle({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-primary" : "bg-border-strong"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function IpSection({ orgId, initial, myIp, onSaved }: { orgId: string; initial: string; myIp: string | null; onSaved: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Section icon={Globe} title="Allowed networks" text="Only allow the workspace (and its API) to be opened from your office or VPN. One address or range per line. Leave empty to allow anywhere.">
      <textarea
        aria-label="Allowed IP addresses and ranges"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={"203.0.113.7\n198.51.100.0/24\n2001:db8::/32"}
        className="w-full max-w-xl rounded-lg border border-border bg-white px-3 py-2 font-mono text-[14px]"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await setIpAllowlistAction(orgId, text);
          setBusy(false);
          if (!r.ok) return void toast.error(r.message);
          toast.success(r.entries ? `Saved ${r.entries} entr${r.entries === 1 ? "y" : "ies"}` : "Open from anywhere");
          onSaved();
        }}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
        {myIp && (
          <span className="text-[13.5px] text-muted">
            Your address: <code className="rounded bg-surface-2 px-1.5">{myIp}</code>{" "}
            <button className="cursor-pointer text-primary hover:underline" onClick={() => setText((t) => (t.trim() ? `${t.trim()}\n${myIp}` : myIp))}>add it</button>
          </span>
        )}
      </div>
    </Section>
  );
}

function AuditExport({ orgId }: { orgId: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const qs = new URLSearchParams({ org: orgId, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5"><Label htmlFor="a-from">From</Label><Input id="a-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="a-to">To</Label><Input id="a-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      <a href={`/api/export/audit?${qs}`} download><Button variant="outline"><Download className="h-4 w-4" /> Download CSV</Button></a>
    </div>
  );
}
