"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ClipboardList, Copy, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { deleteFormAction, listFormsAction, rotateFormLinkAction, saveFormAction } from "@/actions/board-power.actions";
import type { FormField } from "@/db/schema";
import type { ProjectMeta } from "@/server/services/breakdown";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Sheet } from "./sheet";
import type { Column, Member } from "./kanban-board";

type FormRow = Extract<Awaited<ReturnType<typeof listFormsAction>>, { ok: true }>["forms"][number];
type Draft = { id: string | null; name: string; description: string; fields: FormField[]; columnId: string | null; assigneeId: string | null; tagIds: string[]; priority: "low" | "medium" | "high" | "urgent"; enabled: boolean };

const BUILTIN: { key: string; label: string }[] = [
  { key: "title", label: "Summary" },
  { key: "description", label: "Details" },
  { key: "name", label: "Your name" },
  { key: "email", label: "Your email" },
  { key: "priority", label: "Priority" },
  { key: "dueDate", label: "Needed by" },
];

/** Intake forms for a project: a public link; each response becomes a task. */
export function FormsPanel({ organizationId, projectId, columns, members, meta, baseUrl, onClose }: { organizationId: string; projectId: string; columns: Column[]; members: Member[]; meta: ProjectMeta; baseUrl: string; onClose: () => void }) {
  const [rows, setRows] = useState<FormRow[] | null>(null);
  const [defaults, setDefaults] = useState<FormField[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await listFormsAction(organizationId, projectId);
    if (!r.ok) return void toast.error(r.message);
    setRows(r.forms);
    setDefaults(r.defaults);
  }, [organizationId, projectId]);
  useEffect(() => void load(), [load]);

  const linkOf = (token: string) => `${baseUrl}/f/${token}`;
  const available = [...BUILTIN, ...meta.fields.map((f) => ({ key: `custom:${f.id}`, label: f.name }))];

  async function save() {
    if (!draft) return;
    setBusy(true);
    const { id, ...input } = draft;
    const r = await saveFormAction(organizationId, projectId, id, { ...input, description: input.description || null });
    setBusy(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success(id ? "Form saved" : "Form created. Share the link!");
    setDraft(null);
    void load();
  }

  const setField = (i: number, patch: Partial<FormField>) => setDraft((d) => d && { ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  return (
    <Sheet title={<span className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /> Forms</span>} onClose={onClose}>
      <div className="space-y-4 p-5">
        {!draft ? (
          <>
            <p className="text-[14.5px] text-muted">Share a form with clients, other teams or the public. Every response becomes a task here, in the status and with the assignee you choose. No account needed to fill it in.</p>
            <Button onClick={() => setDraft({ id: null, name: "Request form", description: "", fields: defaults, columnId: columns[0]?.id ?? null, assigneeId: null, tagIds: [], priority: "medium", enabled: true })}>
              <Plus className="h-4 w-4" /> New form
            </Button>
            {rows === null ? <Loader2 className="h-5 w-5 animate-spin text-subtle" /> : rows.length === 0 ? (
              <p className="text-[14px] text-subtle">No forms yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {rows.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-semibold">{f.name} {!f.enabled && <span className="rounded bg-surface-2 px-1.5 text-[12px] font-medium text-muted">Off</span>}</div>
                      <div className="text-[13px] text-subtle">{f.submissions} response{f.submissions === 1 ? "" : "s"} · {f.fields.length} fields</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(linkOf(f.token)).then(() => toast.success("Link copied"))}><Copy className="h-4 w-4" /> Copy link</Button>
                    <a href={linkOf(f.token)} target="_blank" rel="noreferrer"><Button size="icon" variant="ghost" aria-label="Open the form"><ExternalLink className="h-4 w-4" /></Button></a>
                    <Button size="icon" variant="ghost" aria-label={`Edit ${f.name}`} onClick={() => setDraft({ id: f.id, name: f.name, description: f.description ?? "", fields: f.fields, columnId: f.columnId, assigneeId: f.assigneeId, tagIds: f.tagIds, priority: f.priority, enabled: f.enabled })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="New link (the old one stops working)" title="New link (the old one stops working)" onClick={async () => {
                      if (!window.confirm("Make a new link? The current link stops working.")) return;
                      const r = await rotateFormLinkAction(organizationId, f.id);
                      if (!r.ok) return void toast.error(r.message);
                      void load();
                    }}><RefreshCw className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${f.name}`} onClick={async () => {
                      if (!window.confirm(`Delete "${f.name}"? Tasks it created stay.`)) return;
                      const r = await deleteFormAction(organizationId, f.id);
                      if (!r.ok) return void toast.error(r.message);
                      void load();
                    }}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="form-name">Form name</Label><Input id="form-name" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label htmlFor="form-desc">Intro text (optional)</Label>
              <textarea id="form-desc" value={draft.description} maxLength={1000} rows={2} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="w-full rounded-lg border border-border px-3 py-2 text-[14.5px]" />
            </div>
            <div>
              <Label>Questions</Label>
              <ul className="mt-2 space-y-2">
                {draft.fields.map((f, i) => (
                  <li key={f.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <Input value={f.label} aria-label="Question label" maxLength={120} onChange={(e) => setField(i, { label: e.target.value })} className="h-8 min-w-0 flex-1" />
                    <span className="text-[12px] text-subtle">{available.find((a) => a.key === f.key)?.label ?? "Field"}</span>
                    <label className="flex items-center gap-1 text-[13px]"><input type="checkbox" checked={f.required || f.key === "title"} disabled={f.key === "title"} onChange={(e) => setField(i, { required: e.target.checked })} /> Required</label>
                    <button aria-label="Move up" disabled={i === 0} onClick={() => setDraft({ ...draft, fields: swap(draft.fields, i, i - 1) })} className="cursor-pointer rounded p-1 text-subtle hover:bg-hover disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                    <button aria-label="Move down" disabled={i === draft.fields.length - 1} onClick={() => setDraft({ ...draft, fields: swap(draft.fields, i, i + 1) })} className="cursor-pointer rounded p-1 text-subtle hover:bg-hover disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                    {f.key !== "title" && <button aria-label="Remove question" onClick={() => setDraft({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })} className="cursor-pointer rounded p-1 text-subtle hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}
                  </li>
                ))}
              </ul>
              {available.some((a) => !draft.fields.some((f) => f.key === a.key)) && (
                <select aria-label="Add a question" value="" onChange={(e) => {
                  const a = available.find((x) => x.key === e.target.value);
                  if (a) setDraft({ ...draft, fields: [...draft.fields, { key: a.key, label: a.label, required: false }] });
                }} className="mt-2 h-9 rounded-lg border border-border bg-white px-2 text-[14px]">
                  <option value="">+ Add a question…</option>
                  {available.filter((a) => !draft.fields.some((f) => f.key === a.key)).map((a) => <option key={a.key} value={a.key}>{a.label}{a.key.startsWith("custom:") ? " (custom field)" : ""}</option>)}
                </select>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="form-col">New tasks go to</Label>
                <select id="form-col" value={draft.columnId ?? ""} onChange={(e) => setDraft({ ...draft, columnId: e.target.value || null })} className="h-10 w-full rounded-lg border border-border bg-white px-2 text-[14px]">
                  {columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="form-who">Assign to</Label>
                <select id="form-who" value={draft.assigneeId ?? ""} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value || null })} className="h-10 w-full rounded-lg border border-border bg-white px-2 text-[14px]">
                  <option value="">Nobody</option>
                  {members.filter((m) => m.role !== "viewer" && m.role !== "guest").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="form-pri">Default priority</Label>
                <select id="form-pri" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Draft["priority"] })} className="h-10 w-full rounded-lg border border-border bg-white px-2 text-[14px]">
                  {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p[0]!.toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
            </div>
            {meta.tags.length > 0 && (
              <div>
                <Label>Tag new tasks</Label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {meta.tags.map((t) => {
                    const on = draft.tagIds.includes(t.id);
                    return (
                      <button key={t.id} aria-pressed={on} onClick={() => setDraft({ ...draft, tagIds: on ? draft.tagIds.filter((x) => x !== t.id) : [...draft.tagIds, t.id] })}
                        className="cursor-pointer rounded-full border px-2.5 py-0.5 text-[13px]" style={on ? { backgroundColor: `${t.color}22`, borderColor: t.color, color: t.color } : undefined}>{t.name}</button>
                    );
                  })}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Accepting responses</label>
            <div className="flex gap-2">
              <Button onClick={save} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {draft.id ? "Save" : "Create form"}</Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function swap<T>(a: T[], i: number, j: number) {
  const b = [...a];
  [b[i], b[j]] = [b[j]!, b[i]!];
  return b;
}
