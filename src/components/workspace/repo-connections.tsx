"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, GitBranch, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { createRepoAction, deleteRepoAction, listReposAction, rotateRepoSecretAction, updateRepoAction } from "@/actions/reach.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { timeAgo } from "@/lib/utils";

type Row = Extract<Awaited<ReturnType<typeof listReposAction>>, { ok: true }>["repos"][number];

/** GitHub / GitLab repositories that link commits, branches and pull requests to tasks. */
export function RepoConnections({ organizationId, baseUrl }: { organizationId: string; baseUrl: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState<{ provider: "github" | "gitlab"; name: string; autoClose: boolean } | null>(null);
  const [shown, setShown] = useState<{ id: string; secret: string } | null>(null);
  const load = useCallback(async () => {
    const r = await listReposAction(organizationId);
    if (!r.ok) return void toast.error(r.message);
    setRows(r.repos);
  }, [organizationId]);
  useEffect(() => void load(), [load]);
  const hookUrl = (r: { provider: string; id: string }) => `${baseUrl}/api/integrations/${r.provider}/${r.id}`;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success("Copied"));

  return (
    <Card className="mt-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-bold"><GitBranch className="h-5 w-5 text-primary" /> GitHub &amp; GitLab</h2>
          <p className="mt-1 max-w-3xl text-[14.5px] text-muted">
            Mention a task like <code className="rounded bg-surface-2 px-1">ENG-12</code> in a commit, branch or pull request and it shows on the task.
            A merged pull request that says <code className="rounded bg-surface-2 px-1">fixes ENG-12</code> moves the task to Done.
          </p>
        </div>
        {!adding && <Button onClick={() => setAdding({ provider: "github", name: "", autoClose: true })}><Plus className="h-4 w-4" /> Connect a repository</Button>}
      </div>

      {adding && (
        <form className="mt-5 max-w-xl space-y-3 rounded-xl border border-border p-4" onSubmit={async (e) => {
          e.preventDefault();
          const r = await createRepoAction(organizationId, adding.provider, adding.name, adding.autoClose);
          if (!r.ok) return void toast.error(r.message);
          setShown({ id: r.id, secret: r.secret });
          setAdding(null);
          void load();
        }}>
          <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label="Provider">
            {(["github", "gitlab"] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={adding.provider === p} onClick={() => setAdding({ ...adding, provider: p })} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-[14px] font-medium ${adding.provider === p ? "bg-white shadow-card" : "text-muted"}`}>{p === "github" ? "GitHub" : "GitLab"}</button>
            ))}
          </div>
          <div className="space-y-1.5"><Label htmlFor="repo-name">Repository</Label><Input id="repo-name" required maxLength={120} placeholder="acme/web-app" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={adding.autoClose} onChange={(e) => setAdding({ ...adding, autoClose: e.target.checked })} /> Move tasks to Done when a pull request that fixes them is merged</label>
          <div className="flex gap-2"><Button>Connect</Button><Button type="button" variant="ghost" onClick={() => setAdding(null)}>Cancel</Button></div>
        </form>
      )}

      {shown && rows?.find((r) => r.id === shown.id) && (() => {
        const r = rows.find((x) => x.id === shown.id)!;
        return (
          <div className="mt-5 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[14px]">
            <p className="font-semibold text-amber-900">Add this webhook to {r.name}. The secret is shown only now.</p>
            <p className="text-amber-900/80">{r.provider === "github"
              ? "GitHub › repository Settings › Webhooks › Add webhook: Payload URL below, content type application/json, the secret below, events: pushes, pull requests, branch creation."
              : "GitLab › project Settings › Webhooks: URL below, the secret as Secret token, triggers: push events and merge request events."}</p>
            {[["Payload URL", hookUrl(r)], [r.provider === "github" ? "Secret" : "Secret token", shown.secret]].map(([label, value]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-muted">{label}</span>
                <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1">{value}</code>
                <Button size="icon" variant="ghost" aria-label={`Copy ${label}`} onClick={() => copy(value!)}><Copy className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setShown(null)}>Done</Button>
          </div>
        );
      })()}

      <ul className="mt-5 divide-y divide-border">
        {rows === null ? <li className="py-3"><Loader2 className="h-5 w-5 animate-spin text-subtle" /></li> : rows.length === 0 ? <li className="py-3 text-[14px] text-subtle">No repositories yet.</li> : rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-semibold">{r.name} <span className="rounded bg-surface-2 px-1.5 text-[12px] font-medium text-muted">{r.provider === "github" ? "GitHub" : "GitLab"}</span>{!r.enabled && <span className="rounded bg-rose-50 px-1.5 text-[12px] text-rose-700">Paused</span>}</div>
              <div className="text-[13px] text-subtle">{r.lastEventAt ? `Last event ${timeAgo(r.lastEventAt)}` : "No events yet"} · {r.autoClose ? "closes tasks on merge" : "links only"}</div>
            </div>
            <Button size="sm" variant="outline" onClick={() => copy(hookUrl(r))}><Copy className="h-4 w-4" /> Webhook URL</Button>
            <label className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" checked={r.autoClose} onChange={async (e) => { const x = await updateRepoAction(organizationId, r.id, e.target.checked, r.enabled); if (!x.ok) toast.error(x.message); void load(); }} /> Auto-close</label>
            <label className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" checked={r.enabled} onChange={async (e) => { const x = await updateRepoAction(organizationId, r.id, r.autoClose, e.target.checked); if (!x.ok) toast.error(x.message); void load(); }} /> On</label>
            <Button size="icon" variant="ghost" aria-label="New secret" title="New secret (update it in the repository too)" onClick={async () => {
              if (!window.confirm("Make a new secret? Deliveries fail until you paste it into the repository's webhook settings.")) return;
              const x = await rotateRepoSecretAction(organizationId, r.id);
              if (!x.ok) return void toast.error(x.message);
              setShown({ id: r.id, secret: x.secret });
            }}><KeyRound className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label={`Disconnect ${r.name}`} onClick={async () => {
              if (!window.confirm(`Disconnect ${r.name}? Existing links on tasks stay.`)) return;
              const x = await deleteRepoAction(organizationId, r.id);
              if (!x.ok) return void toast.error(x.message);
              void load();
            }}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
