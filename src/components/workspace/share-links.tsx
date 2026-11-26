"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Eye, Globe, KeyRound, Link2, Loader2, Plus, X } from "lucide-react";
import { createShareLinkAction, listShareLinksAction, revokeShareLinkAction } from "@/actions/business.actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { cn, formatDay, timeAgo } from "@/lib/utils";

type Project = { id: string; key: string; name: string };
type Link = {
  id: string; label: string; projectId: string | null; projectName: string | null; projectKey: string | null; hasPassword: boolean; includeComments: boolean;
  expiresAt: string | null; revokedAt: string | null; viewCount: number; lastViewedAt: string | null; createdAt: string; createdByName: string | null;
};

const copy = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast.success("Link copied"),
    () => toast.error("Couldn't copy — select the link and copy it")
  );

/** Create a read-only link. Used from Settings and from a project's menu. */
export function ShareLinkDialog({ organizationId, projects, defaultProjectId, onClose, onCreated }: { organizationId: string; projects: Project[]; defaultProjectId?: string; onClose: () => void; onCreated?: () => void }) {
  const [scope, setScope] = useState<"project" | "workspace">("project");
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [expires, setExpires] = useState("30");
  const [password, setPassword] = useState("");
  const [comments, setComments] = useState(false);
  const [confirmWorkspace, setConfirmWorkspace] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      const r = await createShareLinkAction(organizationId, {
        scope, projectId: scope === "project" ? projectId : null, label, expiresInDays: expires ? Number(expires) : null, password: password || null, includeComments: comments,
      });
      if (!r.ok) return void toast.error(r.message);
      setUrl(r.url);
      onCreated?.();
    });

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Share a read-only link">
      <div className="absolute inset-0 bg-[rgba(29,33,41,0.32)]" onClick={onClose} />
      <div className="relative m-auto w-full max-w-lg overflow-hidden rounded-2xl border border-border-strong bg-card shadow-lift">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="flex items-center gap-2 font-semibold"><Link2 className="h-4 w-4 text-primary" /> Share a read-only link</h2>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1.5 text-subtle hover:bg-hover"><X className="h-4 w-4" /></button>
        </div>
        {url ? (
          <div className="space-y-4 px-5 py-5">
            <p className="text-[15px]">Anyone with this link can <b>view</b> {scope === "project" ? "this project" : "every project in the workspace"} without signing in. They can&apos;t change anything.</p>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-[13px]">{url}</code>
              <Button size="sm" onClick={() => copy(url)}><Copy className="h-4 w-4" /> Copy</Button>
            </div>
            <p className="text-[13.5px] text-amber-800">Copy it now — for safety it&apos;s only shown once. You can revoke it any time under Share links.</p>
            <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Done</Button></div>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-5">
            <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="What to share">
              {([["project", "One project"], ["workspace", "Whole workspace"]] as const).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={scope === v} onClick={() => setScope(v)} className={cn("flex-1 cursor-pointer rounded-lg py-1.5 text-[14.5px] font-medium text-muted", scope === v && "bg-white text-foreground shadow-card")}>{l}</button>
              ))}
            </div>
            {scope === "project" ? (
              <label className="block text-[14px] font-medium text-muted">Project
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1.5">
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
                </Select>
              </label>
            ) : (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[14px] text-amber-900">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={confirmWorkspace} onChange={(e) => setConfirmWorkspace(e.target.checked)} />
                I understand that anyone who gets this link (including people it&apos;s forwarded to) can see every project, task and due date in this workspace.
              </label>
            )}
            <label className="block text-[14px] font-medium text-muted">Who it&apos;s for
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Acme client stakeholders" maxLength={80} className="mt-1.5" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[14px] font-medium text-muted">Expires
                <Select value={expires} onChange={(e) => setExpires(e.target.value)} className="mt-1.5">
                  <option value="7">In 7 days</option>
                  <option value="30">In 30 days</option>
                  <option value="90">In 90 days</option>
                  <option value="">Never</option>
                </Select>
              </label>
              <label className="block text-[14px] font-medium text-muted">Password (optional)
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" className="mt-1.5" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[14.5px]">
              <input type="checkbox" className="h-4 w-4" checked={comments} onChange={(e) => setComments(e.target.checked)} /> Include comments
            </label>
            <p className="text-[13px] text-subtle">Shared pages show names but never email addresses, and stop working if the workspace is locked.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={pending || !label.trim() || (scope === "project" && !projectId) || (scope === "workspace" && !confirmWorkspace) || (!!password && password.length < 6)} onClick={create}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Create link
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ShareLinksManager({ organizationId, projects }: { organizationId: string; projects: Project[] }) {
  const [links, setLinks] = useState<Link[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, start] = useTransition();
  const load = useCallback(() => {
    listShareLinksAction(organizationId).then((r) => (r.ok ? setLinks(r.links) : toast.error(r.message)));
  }, [organizationId]);
  useEffect(load, [load]);

  const active = (l: Link) => !l.revokedAt && !(l.expiresAt && new Date(l.expiresAt) < new Date());
  return (
    <>
      <div className="mb-4"><Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New share link</Button></div>
      <Card className="overflow-hidden">
        {links === null && <p className="p-6 text-[15px] text-subtle">Loading…</p>}
        {links?.length === 0 && <p className="p-8 text-center text-[15px] text-subtle">No share links yet. Create one to show a project to a client or stakeholder without giving them an account.</p>}
        {links?.map((l) => (
          <div key={l.id} className={cn("flex flex-wrap items-center gap-3 border-b border-border px-5 py-3.5 last:border-0", !active(l) && "opacity-55")}>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">{l.projectId ? <Link2 className="h-4 w-4" /> : <Globe className="h-4 w-4" />}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{l.label}</span>
                <span className="rounded bg-surface-2 px-1.5 py-px text-[12.5px] text-muted">{l.projectId ? `${l.projectKey} · ${l.projectName}` : "Whole workspace"}</span>
                {l.hasPassword && <span className="inline-flex items-center gap-1 text-[12.5px] text-muted"><KeyRound className="h-3 w-3" /> Password</span>}
                {l.includeComments && <span className="text-[12.5px] text-muted">+ comments</span>}
                {l.revokedAt ? <span className="rounded bg-rose-50 px-1.5 py-px text-[12px] font-medium text-rose-700">Revoked</span> : l.expiresAt && new Date(l.expiresAt) < new Date() ? <span className="rounded bg-surface-2 px-1.5 py-px text-[12px] font-medium text-muted">Expired</span> : null}
              </div>
              <div className="mt-0.5 text-[13px] text-subtle">
                <Eye className="mr-1 inline h-3.5 w-3.5" />{l.viewCount} view{l.viewCount === 1 ? "" : "s"}{l.lastViewedAt ? ` · last ${timeAgo(l.lastViewedAt)}` : ""} · created {timeAgo(l.createdAt)}{l.createdByName ? ` by ${l.createdByName}` : ""} · {l.expiresAt ? `expires ${formatDay(l.expiresAt)}` : "never expires"}
              </div>
            </div>
            {active(l) && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => {
                if (!confirm(`Revoke “${l.label}”? The link stops working immediately.`)) return;
                start(async () => {
                  const r = await revokeShareLinkAction(organizationId, l.id);
                  if (!r.ok) return void toast.error(r.message);
                  load();
                });
              }}>Revoke</Button>
            )}
          </div>
        ))}
      </Card>
      {creating && <ShareLinkDialog organizationId={organizationId} projects={projects} onClose={() => setCreating(false)} onCreated={load} />}
    </>
  );
}
