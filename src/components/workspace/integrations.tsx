"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, Copy, KeyRound, Loader2, Plus, Send, Trash2, Webhook, XCircle } from "lucide-react";
import {
  createApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  listApiKeysAction,
  listWebhooksAction,
  pingWebhookAction,
  revokeApiKeyAction,
  updateWebhookAction,
  webhookDeliveriesAction,
} from "@/actions/automation.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { cn, timeAgo } from "@/lib/utils";

const EVENTS = [
  { id: "task.created", label: "Task created" },
  { id: "task.updated", label: "Task updated or moved" },
  { id: "task.deleted", label: "Task deleted" },
  { id: "comment.created", label: "Comment added" },
] as const;

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error("Couldn't copy — select and copy it manually")
  );
}

/** Shown once, right after creation. */
function Secret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  return (
    <div className="mt-4 animate-fade-up rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="text-[14.5px] font-medium text-amber-900">{label} — copy it now. For your security it won't be shown again.</p>
      <div className="mt-2 flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-[13.5px]">{value}</code>
        <Button size="sm" variant="outline" onClick={() => copy(value, label)}>
          <Copy className="h-4 w-4" /> Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

export function Integrations({ organizationId, baseUrl }: { organizationId: string; baseUrl: string }) {
  return (
    <div className="grid gap-6 2xl:grid-cols-2">
      <ApiKeys organizationId={organizationId} />
      <Webhooks organizationId={organizationId} />
      <ApiReference baseUrl={baseUrl} />
    </div>
  );
}

/* ---------------------------------- API keys ---------------------------------- */

type Key = { id: string; name: string; prefix: string; scope: "read" | "write"; lastUsedAt: string | null; revokedAt: string | null; createdAt: string; ownerName: string };

function ApiKeys({ organizationId }: { organizationId: string }) {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = useCallback(() => {
    listApiKeysAction(organizationId).then((r) => (r.ok ? setKeys(r.keys) : toast.error(r.message)));
  }, [organizationId]);
  useEffect(load, [load]);

  return (
    <Card className="p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound className="h-5 w-5 text-primary" /> API keys</h2>
      <p className="mt-1 text-[14.5px] text-muted">A key acts as you, limited to its scope. It stops working if you leave the workspace or lose the role an action needs.</p>
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createApiKeyAction(organizationId, { name, scope });
            if (!r.ok) return void toast.error(r.message);
            setToken(r.token);
            setName("");
            load();
          });
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. GitHub Actions" maxLength={80} aria-label="Key name" className="h-10 min-w-56 flex-1" />
        <Select value={scope} onChange={(e) => setScope(e.target.value as "read" | "write")} aria-label="Scope" className="h-10 w-40">
          <option value="read">Read only</option>
          <option value="write">Read & write</option>
        </Select>
        <Button className="h-10" disabled={pending || !name.trim()}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create key
        </Button>
      </form>
      {token && <Secret label="API key" value={token} onDone={() => setToken(null)} />}
      <ul className="mt-4 divide-y divide-border">
        {keys?.length === 0 && <li className="py-3 text-[14.5px] text-subtle">No keys yet.</li>}
        {keys?.map((k) => (
          <li key={k.id} className={cn("flex items-center gap-3 py-3", k.revokedAt && "opacity-55")}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{k.name}</span>
                <span className={cn("rounded px-1.5 py-px text-[12px] font-medium", k.scope === "write" ? "bg-amber-100 text-amber-800" : "bg-surface-2 text-muted")}>{k.scope === "write" ? "Read & write" : "Read only"}</span>
                {k.revokedAt && <span className="rounded bg-rose-50 px-1.5 py-px text-[12px] font-medium text-rose-700">Revoked</span>}
              </div>
              <div className="mt-0.5 text-[13px] text-subtle">
                <code className="font-mono">ssk_{k.prefix}_…</code> · {k.ownerName} · created {timeAgo(k.createdAt)} · {k.lastUsedAt ? `used ${timeAgo(k.lastUsedAt)}` : "never used"}
              </div>
            </div>
            {!k.revokedAt && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!confirm(`Revoke “${k.name}”? Anything using it stops working immediately.`)) return;
                  start(async () => {
                    const r = await revokeApiKeyAction(organizationId, k.id);
                    if (!r.ok) return void toast.error(r.message);
                    load();
                  });
                }}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------------------------------- webhooks ---------------------------------- */

type Hook = { id: string; url: string; events: string[]; enabled: boolean; consecutiveFailures: number; lastStatus: number | null; lastDeliveryAt: string | null; secretHint: string };

function Webhooks({ organizationId }: { organizationId: string }) {
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["task.created", "task.updated"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = useCallback(() => {
    listWebhooksAction(organizationId).then((r) => (r.ok ? setHooks(r.webhooks) : toast.error(r.message)));
  }, [organizationId]);
  useEffect(load, [load]);

  return (
    <Card className="p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Webhook className="h-5 w-5 text-primary" /> Webhooks</h2>
      <p className="mt-1 text-[14.5px] text-muted">
        We POST JSON to your https endpoint when things change, signed with <code className="font-mono text-[13px]">SyncSprint-Signature</code>. A hook turns itself off after 15 failed deliveries in a row.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createWebhookAction(organizationId, { url, events });
            if (!r.ok) return void toast.error(r.message);
            setSecret(r.secret);
            setUrl("");
            load();
          });
        }}
      >
        <div className="flex gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/syncsprint" aria-label="Endpoint URL" className="h-10 flex-1" type="url" />
          <Button className="h-10" disabled={pending || !url.trim() || !events.length}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add webhook
          </Button>
        </div>
        <EventPicker value={events} onChange={setEvents} />
      </form>
      {secret && <Secret label="Signing secret" value={secret} onDone={() => setSecret(null)} />}
      <div className="mt-4 space-y-3">
        {hooks?.length === 0 && <p className="text-[14.5px] text-subtle">No webhooks yet.</p>}
        {hooks?.map((h) => <HookRow key={h.id} organizationId={organizationId} hook={h} onChanged={load} />)}
      </div>
    </Card>
  );
}

function EventPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {EVENTS.map((ev) => (
        <label key={ev.id} className="flex cursor-pointer items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-primary)]"
            checked={value.includes(ev.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, ev.id] : value.filter((x) => x !== ev.id))}
          />
          {ev.label}
        </label>
      ))}
    </div>
  );
}

function HookRow({ organizationId, hook, onChanged }: { organizationId: string; hook: Hook; onChanged: () => void }) {
  const [log, setLog] = useState<{ id: string; event: string; statusCode: number | null; ok: boolean; durationMs: number; error: string | null; createdAt: string }[] | null>(null);
  const [pending, start] = useTransition();
  const showLog = () => webhookDeliveriesAction(organizationId, hook.id).then((r) => r.ok && setLog(r.deliveries));
  const failing = hook.consecutiveFailures > 0;
  return (
    <div className="rounded-xl border border-border p-3.5">
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", !hook.enabled ? "bg-border-strong" : failing ? "bg-amber-500" : "bg-emerald-500")} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[14px]">{hook.url}</div>
          <div className="mt-0.5 text-[13px] text-subtle">
            {hook.events.join(", ")} · secret {hook.secretHint}
            {hook.lastDeliveryAt && <> · last delivery {timeAgo(hook.lastDeliveryAt)} ({hook.lastStatus ?? "no response"})</>}
          </div>
          {!hook.enabled && <div className="mt-1 text-[13px] font-medium text-rose-700">Off{failing ? ` after ${hook.consecutiveFailures} failed deliveries` : ""}. Fix the endpoint, then turn it back on.</div>}
          {hook.enabled && failing && <div className="mt-1 text-[13px] font-medium text-amber-700">{hook.consecutiveFailures} failed deliver{hook.consecutiveFailures === 1 ? "y" : "ies"} in a row</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            title="Send a test event"
            onClick={() =>
              start(async () => {
                const r = await pingWebhookAction(organizationId, hook.id);
                if (!r.ok) return void toast.error(r.message);
                if (r.ok && r.error) toast.error(`Test failed: ${r.error}`);
                else toast.success(`Delivered (HTTP ${r.status}, ${r.durationMs} ms)`);
                onChanged();
                if (log) void showLog();
              })
            }
          >
            <Send className="h-4 w-4" /> Test
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await updateWebhookAction(organizationId, hook.id, { enabled: !hook.enabled });
                if (!r.ok) return void toast.error(r.message);
                onChanged();
              })
            }
          >
            {hook.enabled ? "Turn off" : "Turn on"}
          </Button>
          <button
            aria-label="Delete webhook"
            className="cursor-pointer rounded-md p-1.5 text-subtle hover:bg-hover hover:text-rose-600"
            onClick={() => {
              if (!confirm("Delete this webhook?")) return;
              start(async () => {
                const r = await deleteWebhookAction(organizationId, hook.id);
                if (!r.ok) return void toast.error(r.message);
                onChanged();
              });
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <button onClick={() => (log ? setLog(null) : void showLog())} className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[13px] text-muted hover:text-foreground">
        Recent deliveries <ChevronDown className={cn("h-3.5 w-3.5 transition", log && "rotate-180")} />
      </button>
      {log && (
        <ul className="mt-2 space-y-1 text-[13px]">
          {log.length === 0 && <li className="text-subtle">Nothing delivered yet.</li>}
          {log.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              {d.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-rose-600" />}
              <code className="font-mono">{d.event}</code>
              <span className="text-muted">{d.statusCode ?? "—"} · {d.durationMs} ms{d.error ? ` · ${d.error}` : ""}</span>
              <span className="ml-auto text-subtle">{timeAgo(d.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------- API reference -------------------------------- */

function ApiReference({ baseUrl }: { baseUrl: string }) {
  const b = `${baseUrl}/api/v1`;
  const rows: [string, string, string][] = [
    ["GET", "/me", "Check a key: workspace, user and scope"],
    ["GET", "/projects", "Projects with their statuses"],
    ["GET", "/projects/{KEY}/tasks", "Tasks · ?status=&assignee=&updatedSince=&after=&limit="],
    ["POST", "/projects/{KEY}/tasks", "Create · title, description, status, priority, type, assignee (email or id), dates, points, estimateHours"],
    ["GET", "/tasks/{id or ENG-12}", "One task"],
    ["PATCH", "/tasks/{id or ENG-12}", "Update or move (status by name) · send expectedVersion to avoid overwriting newer changes"],
    ["DELETE", "/tasks/{id or ENG-12}", "Delete"],
    ["GET / POST", "/tasks/{id}/comments", "List or add comments · { body }"],
  ];
  const curl = `curl -X POST ${b}/projects/ENG/tasks \\
  -H "Authorization: Bearer ssk_…" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Deploy failed on main","priority":"urgent","status":"In Progress"}'`;
  const verify = `// Node.js: verify a webhook
const [t, v1] = req.headers["syncsprint-signature"].split(",").map((p) => p.split("=")[1]);
const expected = crypto.createHmac("sha256", SECRET).update(\`\${t}.\${rawBody}\`).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected))
  && Math.abs(Date.now() / 1000 - Number(t)) < 300;`;
  return (
    <Card className="p-6 2xl:col-span-2">
      <h2 className="text-lg font-semibold">REST API reference</h2>
      <p className="mt-1 text-[14.5px] text-muted">
        Base URL <code className="font-mono text-[13.5px]">{b}</code> · JSON in and out · 120 requests per minute per key · errors look like <code className="font-mono text-[13px]">{`{"error":{"code","message"}}`}</code>
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-[14px]">
          <tbody>
            {rows.map(([m, p, d]) => (
              <tr key={m + p} className="border-t border-border">
                <td className="whitespace-nowrap py-2 pr-3 font-mono text-[13px] font-semibold text-primary">{m}</td>
                <td className="whitespace-nowrap py-2 pr-4 font-mono text-[13px]">{p}</td>
                <td className="py-2 text-muted">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <CodeBlock title="Create a task" code={curl} />
        <CodeBlock title="Verify a webhook signature" code={verify} />
      </div>
    </Card>
  );
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[13.5px] font-medium text-muted">
        {title}
        <button onClick={() => copy(code, title)} className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"><Copy className="h-3.5 w-3.5" /> Copy</button>
      </div>
      <pre className="overflow-x-auto rounded-xl bg-[#1f2330] p-4 font-mono text-[12.5px] leading-relaxed text-[#e8eaf2]">{code}</pre>
    </div>
  );
}
