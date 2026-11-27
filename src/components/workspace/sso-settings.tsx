"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, KeyRound, Loader2, RefreshCw, Trash2, UsersRound } from "lucide-react";
import {
  devVerifySsoAction, disableScimAction, getSsoAction, removeSsoAction, rotateScimTokenAction, saveSsoAction, setSsoRequiredAction, verifySsoAction,
} from "@/actions/sso.actions";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Section, Toggle } from "./security-settings";

type Sso = Extract<Awaited<ReturnType<typeof getSsoAction>>, { ok: true }>;

const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success("Copied"));
function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
      <span className="w-44 shrink-0 text-muted">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1">{value}</code>
      <Button size="icon" variant="ghost" aria-label={`Copy ${label}`} onClick={() => copy(value)}><Copy className="h-4 w-4" /></Button>
    </div>
  );
}

export function SsoSettings({ org, baseUrl, ssoRequired, scimEnabled, onChanged }: { org: { id: string; isDemo: boolean }; baseUrl: string; ssoRequired: boolean; scimEnabled: boolean; onChanged: () => void }) {
  const [sso, setSso] = useState<Sso | null>(null);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<"oidc" | "saml">("oidc");
  const [busy, setBusy] = useState(false);
  const [scimToken, setScimToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getSsoAction(org.id);
    if (!r.ok) return void toast.error(r.message);
    setSso(r);
    if (r.provider) setKind(r.provider.kind);
  }, [org.id]);
  useEffect(() => void load(), [load]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    const r = await saveSsoAction(org.id, kind === "oidc"
      ? { kind, domains: f.domains!, issuer: f.issuer!, clientId: f.clientId!, clientSecret: f.clientSecret! }
      : { kind, domains: f.domains!, issuer: f.issuer!, entryPoint: f.entryPoint!, cert: f.cert! });
    setBusy(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success("Saved. Now prove you own the domain.");
    setEditing(false);
    void load();
    onChanged();
  }

  const p = sso?.provider;
  return (
    <>
      <Section icon={KeyRound} title="Single sign-on (SSO)" text="Let people sign in with your company's identity provider: Okta, Microsoft Entra ID, Google Workspace, OneLogin, JumpCloud, Auth0 or Keycloak, over OpenID Connect or SAML 2.0. New people with your email domain join this workspace as members on first sign-in.">
        {!sso ? (
          <Loader2 className="h-5 w-5 animate-spin text-subtle" />
        ) : !p || editing ? (
          <form onSubmit={save} className="max-w-2xl space-y-4">
            <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-0.5 text-[14px]" role="tablist">
              {(["oidc", "saml"] as const).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 font-medium ${kind === k ? "bg-white shadow-card" : "text-muted"}`}>
                  {k === "oidc" ? "OpenID Connect" : "SAML 2.0"}
                </button>
              ))}
            </div>
            <div className="space-y-1.5 rounded-lg border border-border bg-surface-2/60 p-3">
              <p className="text-[13.5px] font-medium">Give your identity provider these:</p>
              {kind === "oidc" ? <CopyRow label="Redirect / callback URL" value={sso.urls.oidcRedirect} /> : (
                <>
                  <CopyRow label="ACS (reply) URL" value={sso.urls.samlAcs} />
                  <CopyRow label="Entity ID (audience)" value={sso.urls.samlEntityId} />
                </>
              )}
            </div>
            <Field name="domains" label="Email domain(s)" placeholder="acme.com, acme.co.uk" defaultValue={p?.domains.join(", ")} />
            {kind === "oidc" ? (
              <>
                <Field name="issuer" label="Issuer URL" placeholder="https://acme.okta.com" defaultValue={p?.kind === "oidc" ? p.issuer : ""} />
                <Field name="clientId" label="Client ID" defaultValue={p?.clientId ?? ""} />
                <Field name="clientSecret" label="Client secret" type="password" />
              </>
            ) : (
              <>
                <Field name="issuer" label="IdP entity ID / issuer" placeholder="http://www.okta.com/exk…" defaultValue={p?.kind === "saml" ? p.issuer : ""} />
                <Field name="entryPoint" label="IdP sign-in URL (SSO URL)" placeholder="https://acme.okta.com/app/…/sso/saml" />
                <div className="space-y-1.5">
                  <Label htmlFor="sso-cert">IdP signing certificate (PEM)</Label>
                  <textarea id="sso-cert" name="cert" required rows={5} placeholder="-----BEGIN CERTIFICATE-----" className="w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-[12.5px]" />
                </div>
              </>
            )}
            <div className="flex gap-2">
              <Button disabled={busy || org.isDemo}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
              {p && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
            {org.isDemo && <p className="text-[13px] text-muted">Not available in the demo workspace.</p>}
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[14.5px]">
              <span className="rounded bg-surface-2 px-2 py-0.5 font-semibold">{p.kind === "oidc" ? "OpenID Connect" : "SAML 2.0"}</span>
              <span className="text-muted">{p.issuer}</span>
              <span className="text-muted">·</span>
              <span>{p.domains.join(", ")}</span>
              {p.verified
                ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[12.5px] font-semibold text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" /> Domain verified</span>
                : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[12.5px] font-semibold text-amber-800">Domain not verified</span>}
            </div>
            {!p.verified && (
              <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-[14px] text-amber-900">Add this TXT record at your DNS provider, then check it. Sign-in through SSO stays off until every domain is verified.</p>
                {p.records.map((r) => (
                  <div key={r.domain} className="space-y-1">
                    <CopyRow label="Name / host" value={r.host} />
                    <CopyRow label="Value" value={r.value} />
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={async () => {
                    setBusy(true);
                    const r = await verifySsoAction(org.id);
                    setBusy(false);
                    if (!r.ok) return void toast.error(r.message);
                    toast.success("Domain verified. People can now sign in with SSO.");
                    void load();
                  }}><RefreshCw className="h-4 w-4" /> Check DNS now</Button>
                  {process.env.NODE_ENV !== "production" && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      const r = await devVerifySsoAction(org.id);
                      if (!r.ok) return void toast.error(r.message);
                      void load();
                    }}>Mark verified (local dev only)</Button>
                  )}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Toggle on={ssoRequired} label="Require SSO" disabled={!p.verified} onChange={async (on) => {
                if (on && !window.confirm(`Everyone with an @${p.domains[0]} email will have to sign in through SSO; passwords and Google/Microsoft sign-in stop working for them. Continue?`)) return;
                const r = await setSsoRequiredAction(org.id, on);
                if (!r.ok) return void toast.error(r.message);
                toast.success(on ? "SSO is now required for your domain" : "SSO is optional again");
                onChanged();
              }} />
              <span className="text-[14.5px]">Require SSO for {p.domains.map((d) => `@${d}`).join(", ")}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Change settings</Button>
              <Button size="sm" variant="ghost" onClick={async () => {
                if (!window.confirm("Remove single sign-on? People will sign in with passwords or Google/Microsoft again.")) return;
                const r = await removeSsoAction(org.id);
                if (!r.ok) return void toast.error(r.message);
                void load();
                onChanged();
              }}><Trash2 className="h-4 w-4 text-rose-600" /> Remove</Button>
            </div>
          </div>
        )}
      </Section>

      <Section icon={UsersRound} title="Automatic provisioning (SCIM)" text="Your identity provider adds people to this workspace when you assign them the app, updates their names, and removes them when they leave the company.">
        <div className="space-y-3">
          <CopyRow label="SCIM base URL" value={`${baseUrl}/api/scim/v2`} />
          {scimToken && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="mb-2 text-[13.5px] text-amber-900">Copy this token into your identity provider now. It won&apos;t be shown again.</p>
              <CopyRow label="Bearer token" value={scimToken} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px]">{scimEnabled || scimToken ? "SCIM is on." : "SCIM is off."}</span>
            <Button size="sm" variant="outline" disabled={org.isDemo} onClick={async () => {
              if ((scimEnabled || scimToken) && !window.confirm("Make a new token? The current one stops working immediately.")) return;
              const r = await rotateScimTokenAction(org.id);
              if (!r.ok) return void toast.error(r.message);
              setScimToken(r.token);
              onChanged();
            }}>{scimEnabled || scimToken ? "Make a new token" : "Turn on and create token"}</Button>
            {(scimEnabled || scimToken) && (
              <Button size="sm" variant="ghost" onClick={async () => {
                const r = await disableScimAction(org.id);
                if (!r.ok) return void toast.error(r.message);
                setScimToken(null);
                onChanged();
              }}>Turn off</Button>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}

function Field({ name, label, placeholder, defaultValue, type = "text" }: { name: string; label: string; placeholder?: string; defaultValue?: string; type?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`sso-${name}`}>{label}</Label>
      <Input id={`sso-${name}`} name={name} type={type} required placeholder={placeholder} defaultValue={defaultValue} autoComplete="off" />
    </div>
  );
}
