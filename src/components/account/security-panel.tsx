"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import QRCode from "qrcode";
import { AlertTriangle, Copy, Laptop, Loader2, LogOut, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { timeAgo } from "@/lib/utils";

type Props = { enabled: boolean; isDemo: boolean; hasPassword: boolean; linked: string[]; requiredBy: string | null; requiredSlug: string | null };
type Setup = { uri: string; qr: string; secret: string; backupCodes: string[] };

export function SecurityPanel(props: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(props.enabled);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(password: string) {
    setBusy(true);
    const { data, error } = await authClient.twoFactor.enable({ password: props.hasPassword ? password : undefined, issuer: "SyncSprint" } as { password: string });
    setBusy(false);
    if (error || !data || !("totpURI" in data)) return void toast.error(error?.message ?? "Couldn't start set-up");
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    setSetup({ uri: data.totpURI, qr: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 }), secret, backupCodes: data.backupCodes });
  }
  async function confirm(code: string) {
    setBusy(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) return void toast.error(error.message ?? "That code didn't match. Check the time on your phone and try again.");
    setCodes(setup!.backupCodes);
    setSetup(null);
    setEnabled(true);
    toast.success("Two-step sign-in is on");
    router.refresh();
  }
  async function turnOff(password: string) {
    if (!window.confirm("Turn off two-step sign-in? Workspaces that require it will stop letting you in.")) return;
    setBusy(true);
    const { error } = await authClient.twoFactor.disable({ password: props.hasPassword ? password : undefined } as { password: string });
    setBusy(false);
    if (error) return void toast.error(error.message ?? "Couldn't turn it off");
    setEnabled(false);
    setCodes(null);
    toast.success("Two-step sign-in is off");
    router.refresh();
  }
  async function newCodes(password: string) {
    setBusy(true);
    const { data, error } = await authClient.twoFactor.generateBackupCodes({ password: props.hasPassword ? password : undefined } as { password: string });
    setBusy(false);
    if (error || !data) return void toast.error(error?.message ?? "Couldn't make new codes");
    setCodes(data.backupCodes);
    toast.success("New backup codes made; the old ones no longer work");
  }

  return (
    <div className="space-y-6">
      {props.requiredBy && !enabled && (
        <Card className="flex items-start gap-3 border-amber-200 bg-amber-50 p-5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="text-[15px]">
            <b>{props.requiredBy}</b> requires two-step sign-in. Turn it on below, then you can open the workspace again.
          </div>
        </Card>
      )}
      {props.requiredBy && enabled && props.requiredSlug && (
        <Card className="flex items-center gap-3 border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <ShieldCheck className="h-5 w-5" />
          <span className="text-[15px]">All set. </span>
          <Link href={`/w/${props.requiredSlug}`} className="font-semibold underline">Open {props.requiredBy}</Link>
        </Card>
      )}

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              {enabled ? <ShieldCheck className="h-5 w-5 text-emerald-600" /> : <ShieldOff className="h-5 w-5 text-subtle" />}
              Two-step sign-in {enabled ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[12.5px] font-semibold text-emerald-800">On</span> : <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12.5px] font-semibold text-muted">Off</span>}
            </h2>
            <p className="mt-1 max-w-2xl text-[14.5px] text-muted">
              After your password, enter a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…). Someone with your password still can't get in.
            </p>
          </div>
        </div>

        {props.isDemo ? (
          <p className="mt-4 text-[14px] text-muted">Not available on a demo account.</p>
        ) : setup ? (
          <div className="mt-5 grid gap-6 md:grid-cols-[auto_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code to scan with your authenticator app" width={220} height={220} className="rounded-lg border border-border" />
            <div className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-[14.5px]">
                <li>Scan the code with your authenticator app.</li>
                <li>Can't scan? Enter this key: <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[13px]">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code></li>
                <li>Type the 6-digit code it shows to finish.</li>
              </ol>
              <CodeForm busy={busy} label="Code from the app" onSubmit={confirm} submit="Turn on" />
              <button className="cursor-pointer text-[13.5px] text-muted hover:underline" onClick={() => setSetup(null)}>Cancel</button>
            </div>
          </div>
        ) : !enabled ? (
          <PasswordForm busy={busy} needPassword={props.hasPassword} actions={[{ label: "Set up two-step sign-in", run: start }]} />
        ) : (
          <PasswordForm busy={busy} needPassword={props.hasPassword} actions={[
            { label: "Make new backup codes", variant: "outline", run: newCodes },
            { label: "Turn off", variant: "destructive", run: turnOff },
          ]} />
        )}

        {codes && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
            <h3 className="font-semibold text-amber-900">Save your backup codes</h3>
            <p className="mt-1 text-[14px] text-amber-900/80">If you lose your phone, each of these gets you in once. They won't be shown again.</p>
            <div className="mt-3 grid max-w-md grid-cols-2 gap-2 font-mono text-[14.5px]">
              {codes.map((c) => <span key={c} className="rounded bg-white px-2 py-1">{c}</span>)}
            </div>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success("Copied"))}>
              <Copy className="h-4 w-4" /> Copy all
            </Button>
          </div>
        )}
      </Card>

      {props.linked.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-bold">Linked sign-in</h2>
          <p className="mt-1 text-[14.5px] text-muted">You can also sign in with: {props.linked.map((p) => p.replace(/^./, (c) => c.toUpperCase())).join(", ")}.</p>
        </Card>
      )}

      <Sessions />
    </div>
  );
}

/** One password field (when the account has one) shared by one or more actions. */
function PasswordForm({ busy, needPassword, actions }: { busy: boolean; needPassword: boolean; actions: { label: string; variant?: "outline" | "destructive"; run: (pw: string) => void }[] }) {
  const [pw, setPw] = useState("");
  const go = (run: (pw: string) => void) => {
    if (needPassword && !pw) return void toast.error("Enter your password first");
    run(pw);
  };
  return (
    <form className="mt-6 flex flex-wrap items-end gap-x-4 gap-y-3" onSubmit={(e) => { e.preventDefault(); go(actions[0]!.run); }}>
      {needPassword && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-pw">Confirm your password</Label>
          <Input id="confirm-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className="w-72" />
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {actions.map((a, i) => (
          <Button key={a.label} type={i === 0 ? "submit" : "button"} disabled={busy} variant={a.variant} onClick={i === 0 ? undefined : () => go(a.run)}>
            {busy && i === 0 && <Loader2 className="h-4 w-4 animate-spin" />} {a.label}
          </Button>
        ))}
      </div>
    </form>
  );
}

function CodeForm({ busy, label, submit, onSubmit }: { busy: boolean; label: string; submit: string; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-x-4 gap-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(code); }}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="totp-code">{label}</Label>
        <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} className="w-40 text-center tracking-[0.3em]" autoFocus />
      </div>
      <Button disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {submit}</Button>
    </form>
  );
}

type SessionRow = { id: string; token: string; createdAt: Date | string; updatedAt: Date | string; ipAddress?: string | null; userAgent?: string | null };

/** Readable IP: loopback / unspecified (local development) says so; IPv6 runs of zeros are shortened. */
export function formatIp(ip: string | null | undefined) {
  if (!ip) return "Unknown address";
  const v = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  const groups = v.includes(":") ? v.split(":").map((g) => g.replace(/^0+(?=.)/, "")) : null;
  const zero = groups?.every((g) => g === "0" || g === "");
  const loop = groups ? groups.slice(0, -1).every((g) => g === "0" || g === "") && groups[groups.length - 1] === "1" : false;
  if (zero || loop || v.startsWith("127.") || v === "localhost") return "This computer (local)";
  if (!groups) return v;
  // Collapse the longest run of zero groups to "::".
  let best = [-1, 0], cur = [-1, 0];
  groups.forEach((g, i) => {
    if (g === "0") { cur = cur[0] < 0 ? [i, 1] : [cur[0], cur[1] + 1]; if (cur[1] > best[1]) best = [...cur]; }
    else cur = [-1, 0];
  });
  if (best[1] < 2) return groups.join(":");
  return `${groups.slice(0, best[0]).join(":")}::${groups.slice(best[0] + best[1]).join(":")}`;
}

function deviceName(ua: string | null | undefined) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

function Sessions() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const { data: current } = authClient.useSession();
  const load = useCallback(async () => {
    const { data, error } = await authClient.listSessions();
    if (error) return void toast.error(error.message ?? "Couldn't load your sessions");
    setRows((data as SessionRow[]).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)));
  }, []);
  useEffect(() => void load(), [load]);
  const mine = current?.session.token;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Where you're signed in</h2>
          <p className="mt-1 text-[14.5px] text-muted">Sign out anywhere you don't recognise, or a device you've lost.</p>
        </div>
        {rows && rows.length > 1 && (
          <Button variant="outline" size="sm" onClick={async () => {
            const { error } = await authClient.revokeOtherSessions();
            if (error) return void toast.error(error.message ?? "Couldn't sign out the others");
            toast.success("Signed out everywhere else");
            void load();
          }}><LogOut className="h-4 w-4" /> Sign out all other devices</Button>
        )}
      </div>
      <ul className="mt-4 divide-y divide-border">
        {rows === null ? (
          <li className="py-4"><Loader2 className="h-5 w-5 animate-spin text-subtle" /></li>
        ) : rows.map((s) => {
          const isMine = s.token === mine;
          const mobile = /Android|iPhone|iPad|Mobile/.test(s.userAgent ?? "");
          return (
            <li key={s.id} className="flex items-center gap-3 py-3">
              {mobile ? <Smartphone className="h-5 w-5 text-subtle" /> : <Laptop className="h-5 w-5 text-subtle" />}
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{deviceName(s.userAgent)} {isMine && <span className="ml-1 rounded bg-primary-soft px-1.5 py-0.5 text-[12px] font-semibold text-primary">This device</span>}</div>
                <div className="text-[13px] text-subtle">{formatIp(s.ipAddress)} · active {timeAgo(s.updatedAt)} · signed in {timeAgo(s.createdAt)}</div>
              </div>
              {!isMine && (
                <Button size="sm" variant="ghost" onClick={async () => {
                  const { error } = await authClient.revokeSession({ token: s.token });
                  if (error) return void toast.error(error.message ?? "Couldn't sign it out");
                  setRows((r) => r?.filter((x) => x.id !== s.id) ?? null);
                }}>Sign out</Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
