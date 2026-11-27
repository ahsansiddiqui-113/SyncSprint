"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, MessageSquare, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { deleteChatChannelAction, listChatChannelsAction, saveChatChannelAction, testChatChannelAction } from "@/actions/reach.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { timeAgo } from "@/lib/utils";

type Row = Extract<Awaited<ReturnType<typeof listChatChannelsAction>>, { ok: true }>["channels"][number];
type Kind = Row["kind"];
const KINDS: { id: Kind; label: string; help: string }[] = [
  { id: "slack", label: "Slack", help: "Slack › Apps › Incoming Webhooks › Add to a channel, then copy the Webhook URL (https://hooks.slack.com/services/…)." },
  { id: "teams", label: "Microsoft Teams", help: "In the channel: ••• › Workflows › \"Post to a channel when a webhook request is received\", then copy the URL." },
  { id: "discord", label: "Discord", help: "Channel settings › Integrations › Webhooks › New Webhook › Copy Webhook URL." },
  { id: "google_chat", label: "Google Chat", help: "Space › Apps & integrations › Webhooks › Add, then copy the URL." },
];
const EVENTS = [
  { id: "task.created", label: "New tasks" },
  { id: "task.status", label: "Status changes" },
  { id: "task.assigned", label: "Assignments" },
  { id: "comment.created", label: "Comments" },
] as const;
type Draft = { id: string | null; kind: Kind; name: string; url: string; projectId: string | null; events: (typeof EVENTS)[number]["id"][]; enabled: boolean };

export function ChatChannels({ organizationId, projects }: { organizationId: string; projects: { id: string; key: string; name: string }[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await listChatChannelsAction(organizationId);
    if (!r.ok) return void toast.error(r.message);
    setRows(r.channels);
  }, [organizationId]);
  useEffect(() => void load(), [load]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    const { id, ...input } = draft;
    const r = await saveChatChannelAction(organizationId, id, { ...input, url: input.url || undefined });
    setBusy(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success(id ? "Saved" : "Connected. Send a test to check it.");
    setDraft(null);
    void load();
  }

  return (
    <Card className="mt-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-bold"><MessageSquare className="h-5 w-5 text-primary" /> Chat alerts</h2>
          <p className="mt-1 max-w-3xl text-[14.5px] text-muted">Post new tasks, status changes, assignments and comments to Slack, Microsoft Teams, Discord or Google Chat. Follow the whole workspace or one project.</p>
        </div>
        {!draft && <Button onClick={() => setDraft({ id: null, kind: "slack", name: "", url: "", projectId: null, events: ["task.created", "task.status"], enabled: true })}><Plus className="h-4 w-4" /> Add channel</Button>}
      </div>

      {draft && (
        <div className="mt-5 max-w-2xl space-y-3 rounded-xl border border-border p-4">
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label="Chat app">
            {KINDS.map((k) => (
              <button key={k.id} role="radio" aria-checked={draft.kind === k.id} onClick={() => setDraft({ ...draft, kind: k.id })} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-[14px] font-medium ${draft.kind === k.id ? "bg-white shadow-card" : "text-muted"}`}>{k.label}</button>
            ))}
          </div>
          <p className="text-[13px] text-subtle">{KINDS.find((k) => k.id === draft.kind)!.help}</p>
          <div className="space-y-1.5"><Label htmlFor="ch-name">Name</Label><Input id="ch-name" value={draft.name} maxLength={80} placeholder="#eng-updates" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="ch-url">Webhook URL{draft.id ? " (leave empty to keep the current one)" : ""}</Label><Input id="ch-url" type="password" autoComplete="off" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="ch-project">Follow</Label>
            <select id="ch-project" value={draft.projectId ?? ""} onChange={(e) => setDraft({ ...draft, projectId: e.target.value || null })} className="h-10 w-full rounded-lg border border-border bg-white px-2 text-[14px]">
              <option value="">Every project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
            </select>
          </div>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-[14px] font-medium">Send</legend>
            {EVENTS.map((ev) => (
              <label key={ev.id} className="flex items-center gap-1.5 text-[14px]">
                <input type="checkbox" checked={draft.events.includes(ev.id)} onChange={(e) => setDraft({ ...draft, events: e.target.checked ? [...draft.events, ev.id] : draft.events.filter((x) => x !== ev.id) })} /> {ev.label}
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={save}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {draft.id ? "Save" : "Connect"}</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <ul className="mt-5 divide-y divide-border">
        {rows === null ? <li className="py-3"><Loader2 className="h-5 w-5 animate-spin text-subtle" /></li> : rows.length === 0 ? <li className="py-3 text-[14px] text-subtle">No chat channels yet.</li> : rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-semibold">
                {c.name} <span className="rounded bg-surface-2 px-1.5 text-[12px] font-medium text-muted">{KINDS.find((k) => k.id === c.kind)?.label}</span>
                {!c.enabled && <span className="rounded bg-rose-50 px-1.5 text-[12px] font-medium text-rose-700">Off</span>}
              </div>
              <div className="text-[13px] text-subtle">
                {c.projectKey ? `Project ${c.projectKey}` : "Every project"} · {c.events.length} event{c.events.length === 1 ? "" : "s"} · {c.urlHint}
                {c.lastSentAt ? ` · last sent ${timeAgo(c.lastSentAt)}` : ""}
              </div>
              {c.lastError && <div className="flex items-center gap-1 text-[13px] text-rose-700"><AlertTriangle className="h-3.5 w-3.5" /> {c.lastError}{!c.enabled ? " (turned off after repeated failures; edit and save to turn back on)" : ""}</div>}
            </div>
            <Button size="sm" variant="outline" onClick={async () => {
              const r = await testChatChannelAction(organizationId, c.id);
              if (!r.ok) return void toast.error(r.message);
              toast.success("Test message sent");
              void load();
            }}><Send className="h-4 w-4" /> Test</Button>
            <Button size="icon" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => setDraft({ id: c.id, kind: c.kind, name: c.name, url: "", projectId: c.projectId, events: c.events as Draft["events"], enabled: true })}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label={`Remove ${c.name}`} onClick={async () => {
              if (!window.confirm(`Disconnect ${c.name}?`)) return;
              const r = await deleteChatChannelAction(organizationId, c.id);
              if (!r.ok) return void toast.error(r.message);
              void load();
            }}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
