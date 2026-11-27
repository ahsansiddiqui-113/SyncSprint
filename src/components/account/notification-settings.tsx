"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, BellRing, Inbox, Loader2, Mail, MessageCircle, Smartphone, Trash2 } from "lucide-react";
import {
  devOutboxAction, getNotificationPrefsAction, removePushSubscriptionAction, savePushSubscriptionAction, sendTestPushAction, setNotificationPrefsAction,
} from "@/actions/reach.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { timeAgo } from "@/lib/utils";

type Data = Extract<Awaited<ReturnType<typeof getNotificationPrefsAction>>, { ok: true }>;
type Prefs = Data["workspaces"][number]["prefs"];

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export function NotificationSettings({ showOutbox }: { showOutbox: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [pushState, setPushState] = useState<"unsupported" | "default" | "granted" | "denied">("default");
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await getNotificationPrefsAction();
    if (!r.ok) return void toast.error(r.message);
    setData(r);
  }, []);
  useEffect(() => {
    void load();
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setPushState("unsupported");
    setPushState(Notification.permission === "default" ? "default" : Notification.permission);
    void navigator.serviceWorker.getRegistration("/").then((r) => r?.pushManager.getSubscription()).then((s) => setThisEndpoint(s?.endpoint ?? null));
  }, [load]);

  async function enablePush() {
    if (!data?.vapidPublicKey) return void toast.error("Push isn't set up on this server yet (VAPID keys).");
    const perm = await Notification.requestPermission();
    setPushState(perm === "default" ? "default" : perm);
    if (perm !== "granted") return void toast.error("Notifications are blocked for this site in your browser settings.");
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(data.vapidPublicKey) });
    const r = await savePushSubscriptionAction(sub.toJSON());
    if (!r.ok) return void toast.error(r.message);
    setThisEndpoint(sub.endpoint);
    toast.success("Push is on for this device");
    void load();
  }

  async function save(organizationId: string, prefs: Prefs) {
    const r = await setNotificationPrefsAction(organizationId, prefs);
    if (!r.ok) return void toast.error(r.message);
    toast.success("Saved");
    void load();
  }

  if (!data) return <Loader2 className="h-6 w-6 animate-spin text-subtle" />;
  const thisDevice = data.devices.find((d) => d.endpoint === thisEndpoint);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold"><BellRing className="h-5 w-5 text-primary" /> Push notifications</h2>
        <p className="mt-1 max-w-2xl text-[14.5px] text-muted">Get mentions, assignments and reminders on this computer or phone, even when SyncSprint is closed. On iPhone, first add SyncSprint to your Home Screen (Share › Add to Home Screen).</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {!data.channels.push ? (
            <span className="text-[14px] text-muted">Not set up on this server yet. An administrator needs to add VAPID keys.</span>
          ) : pushState === "unsupported" ? (
            <span className="text-[14px] text-muted">This browser doesn&apos;t support push notifications.</span>
          ) : thisDevice ? (
            <>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[13px] font-semibold text-emerald-800">On for this device</span>
              <Button size="sm" variant="outline" onClick={async () => {
                const r = await sendTestPushAction();
                if (!r.ok) return void toast.error(r.message);
                toast.success(r.sent ? "Test sent; it should appear in a moment" : "No device received it");
              }}>Send a test</Button>
            </>
          ) : (
            <Button onClick={enablePush} disabled={pushState === "denied"}><Bell className="h-4 w-4" /> {pushState === "denied" ? "Blocked in browser settings" : "Turn on for this device"}</Button>
          )}
        </div>
        {data.devices.length > 0 && (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {data.devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-[14px]">
                <Smartphone className="h-4 w-4 text-subtle" />
                <span className="min-w-0 flex-1 truncate">{d.userAgent ?? "Device"}{d.endpoint === thisEndpoint ? " (this device)" : ""}</span>
                <Button size="icon" variant="ghost" aria-label="Stop push to this device" onClick={async () => {
                  const r = await removePushSubscriptionAction(d.endpoint);
                  if (!r.ok) return void toast.error(r.message);
                  if (d.endpoint === thisEndpoint) {
                    const reg = await navigator.serviceWorker.getRegistration("/");
                    await (await reg?.pushManager.getSubscription())?.unsubscribe();
                    setThisEndpoint(null);
                  }
                  void load();
                }}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.workspaces.map((w) => <WorkspacePrefs key={w.organizationId} name={w.name} prefs={w.prefs} channels={data.channels} onSave={(p) => save(w.organizationId, p)} />)}
      {data.workspaces.length === 0 && <Card className="p-6 text-[14.5px] text-muted">Join a workspace to choose how you hear about it.</Card>}

      {showOutbox && <DevOutbox />}
    </div>
  );
}

function WorkspacePrefs({ name, prefs, channels, onSave }: { name: string; prefs: Prefs; channels: Data["channels"]; onSave: (p: Prefs) => Promise<void> }) {
  const [p, setP] = useState<Prefs>(prefs);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(p) !== JSON.stringify(prefs);
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">{name}</h2>
      <div className="mt-4 space-y-4">
        <Row icon={Bell} title="Push" text="Mentions, assignments, comments on your tasks, reminders.">
          <input type="checkbox" aria-label={`Push for ${name}`} checked={p.push} onChange={(e) => setP({ ...p, push: e.target.checked })} />
        </Row>
        <Row icon={Mail} title="Email each notification" text={channels.email ? "One email per notification, as it happens." : "Email isn't set up on this server yet; messages go to the developer outbox."}>
          <input type="checkbox" aria-label={`Email each notification for ${name}`} checked={p.emailInstant} onChange={(e) => setP({ ...p, emailInstant: e.target.checked })} />
        </Row>
        <Row icon={Inbox} title="Email summary" text="Overdue and due-soon work, plus anything unread in your inbox.">
          <select aria-label={`Email summary for ${name}`} value={p.digest} onChange={(e) => setP({ ...p, digest: e.target.value as Prefs["digest"] })} className="h-9 rounded-lg border border-border bg-white px-2 text-[14px]">
            <option value="off">Off</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
          </select>
        </Row>
        <Row icon={MessageCircle} title="WhatsApp" text={channels.whatsapp ? "Short alerts on WhatsApp." : "WhatsApp isn't connected on this server yet; messages go to the developer outbox."}>
          <div className="flex items-center gap-2">
            <Input aria-label={`WhatsApp number for ${name}`} placeholder="+923001234567" value={p.whatsappPhone ?? ""} onChange={(e) => setP({ ...p, whatsappPhone: e.target.value || null })} className="h-9 w-44" />
            <input type="checkbox" aria-label={`WhatsApp for ${name}`} checked={p.whatsapp} onChange={(e) => setP({ ...p, whatsapp: e.target.checked })} />
          </div>
        </Row>
      </div>
      {dirty && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); await onSave(p); setBusy(false); }}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setP(prefs)}>Cancel</Button>
        </div>
      )}
    </Card>
  );
}

function Row({ icon: Icon, title, text, children }: { icon: typeof Bell; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Icon className="h-5 w-5 text-subtle" />
      <div className="min-w-0 flex-1">
        <Label className="text-[15px] font-semibold">{title}</Label>
        <p className="text-[13.5px] text-muted">{text}</p>
      </div>
      {children}
    </div>
  );
}

function DevOutbox() {
  const [rows, setRows] = useState<Extract<Awaited<ReturnType<typeof devOutboxAction>>, { ok: true }>["rows"] | null>(null);
  useEffect(() => void devOutboxAction().then((r) => r.ok && setRows(r.rows)), []);
  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold">Developer outbox</h2>
      <p className="mt-1 text-[14px] text-muted">Local development only: emails and WhatsApp messages that would have been sent.</p>
      <ul className="mt-3 divide-y divide-border text-[13.5px]">
        {rows?.length ? rows.map((r) => (
          <li key={r.id} className="py-2">
            <div className="flex gap-2"><b className="uppercase text-subtle">{r.channel}</b> <span className="truncate">{r.to}</span> <span className="ml-auto text-subtle">{r.status} · {timeAgo(r.createdAt)}</span></div>
            <div className="font-medium">{r.subject}</div>
            {r.body && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-[12.5px]">{r.body}</pre>}
          </li>
        )) : <li className="py-2 text-subtle">Nothing yet.</li>}
      </ul>
    </Card>
  );
}
