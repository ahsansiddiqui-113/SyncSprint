"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Crown, Pencil, Plus, Trash2, UsersRound, X } from "lucide-react";
import type { OrgRole } from "@/db/schema";
import { isAdminRole } from "@/lib/rbac-shared";
import { TAG_COLORS } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";
import { createTeamAction, deleteTeamAction, updateTeamAction } from "@/actions/business.actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";

export type Group = { id: string; name: string; handle: string; color: string; description: string | null; leadId: string | null; memberIds: string[] };
export type Person = { id: string; name: string; avatarUrl: string | null; role: OrgRole };

export function GroupsBoard({ org, meId, role, initial, members }: { org: { id: string; slug: string }; meId: string; role: OrgRole; initial: Group[]; members: Person[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const admin = isAdminRole(role);
  const byId = new Map(members.map((m) => [m.id, m]));

  return (
    <>
      {admin && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> New group</Button>
          {initial.length === 0 && (
            <span className="text-[14px] text-subtle">Tip: start with the teams you already have, e.g. Developers, QA, Design, Marketing.</span>
          )}
        </div>
      )}
      {initial.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <UsersRound className="h-9 w-9 text-subtle" />
          <p className="text-[16px] font-medium">No groups yet</p>
          <p className="max-w-md text-[15px] text-subtle">{admin ? "Create groups so work can be sent to a whole team and tracked by team." : "Admins can create groups for your teams."}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {initial.map((g) => {
            const canEdit = admin || g.leadId === meId;
            const lead = g.leadId ? byId.get(g.leadId) : null;
            return (
              <Card key={g.id} className="group relative flex flex-col p-5">
                <Link href={`/w/${org.slug}/groups/${g.id}`} className="absolute inset-0 rounded-xl" aria-label={`Open ${g.name}`} />
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white" style={{ backgroundColor: g.color }}>
                    {g.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[17px] font-semibold group-hover:text-primary">{g.name}</h2>
                    <p className="font-mono text-[13px] text-subtle">@{g.handle}</p>
                  </div>
                  {canEdit && (
                    <button onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`} className="relative z-10 cursor-pointer rounded-md p-1.5 text-subtle hover:bg-hover hover:text-foreground">
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {g.description && <p className="mt-3 line-clamp-2 text-[14.5px] text-muted">{g.description}</p>}
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {g.memberIds.slice(0, 6).map((id) => {
                      const m = byId.get(id);
                      return m ? <Avatar key={id} id={id} name={m.name} src={m.avatarUrl} size={28} ring /> : null;
                    })}
                  </div>
                  <span className="text-[14px] text-muted">{g.memberIds.length} {g.memberIds.length === 1 ? "person" : "people"}</span>
                  {lead && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[13px] text-subtle"><Crown className="h-3.5 w-3.5 text-amber-500" /> {lead.name}</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing && (
        <GroupEditor
          org={org}
          admin={admin}
          group={editing === "new" ? null : editing}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

export function GroupEditor({ org, admin, group, members, onClose, onSaved }: { org: { id: string }; admin: boolean; group: Group | null; members: Person[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [color, setColor] = useState(group?.color ?? TAG_COLORS[0]);
  const [leadId, setLeadId] = useState(group?.leadId ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(group?.memberIds ?? []));
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();
  const shown = members.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()));

  const save = () =>
    start(async () => {
      const input = { name, description: description || null, color, ...(admin ? { leadId: leadId || null } : {}), memberIds: [...picked] };
      const r = group ? await updateTeamAction(org.id, group.id, input) : await createTeamAction(org.id, input);
      if (!r.ok) return void toast.error(r.message);
      toast.success(group ? "Group updated" : `${name} created`);
      onSaved();
    });

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={group ? `Edit ${group.name}` : "New group"}>
      <div className="absolute inset-0 bg-[rgba(29,33,41,0.32)]" onClick={onClose} />
      <div className="relative m-auto flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border-strong bg-card shadow-lift">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="font-semibold">{group ? `Edit ${group.name}` : "New group"}</h2>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1.5 text-subtle hover:bg-hover"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="text-[14px] font-medium text-muted">
              Name
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="QA, Developers, Marketing…" maxLength={60} className="mt-1.5" />
            </label>
            <div className="text-[14px] font-medium text-muted">
              Color
              <div className="mt-1.5 flex h-11 items-center gap-1">
                {TAG_COLORS.slice(0, 6).map((c) => (
                  <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setColor(c)} className={cn("h-6 w-6 cursor-pointer rounded-md", color === c && "ring-2 ring-offset-2 ring-foreground/40")} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
          </div>
          <label className="block text-[14px] font-medium text-muted">
            What this group does (optional)
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} className="mt-1.5 min-h-16" />
          </label>
          {admin && (
            <label className="block text-[14px] font-medium text-muted">
              Lead (can manage this group&apos;s members)
              <Select value={leadId} onChange={(e) => setLeadId(e.target.value)} className="mt-1.5">
                <option value="">No lead</option>
                {members.filter((m) => m.role !== "viewer").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </label>
          )}
          <div>
            <div className="flex items-center justify-between text-[14px] font-medium text-muted">
              Members · {picked.size}
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" aria-label="Filter people" className="h-8 w-40 rounded-md border border-border px-2 text-[14px] outline-none focus:border-primary" />
            </div>
            <div className="mt-2 max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
              {shown.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={picked.has(m.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(m.id); else n.delete(m.id); return n; })} />
                  <Avatar id={m.id} name={m.name} src={m.avatarUrl} size={24} />
                  <span className="flex-1 text-[14.5px]">{m.name}</span>
                  <span className="text-[12.5px] capitalize text-subtle">{m.role === "owner" ? "admin" : m.role}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border bg-surface-2 px-5 py-3">
          {group && admin && (
            <Button variant="ghost" className="text-rose-600" disabled={pending} onClick={() => {
              if (!confirm(`Delete ${group.name}? Tasks assigned to it stay, just without a group.`)) return;
              start(async () => {
                const r = await deleteTeamAction(org.id, group.id);
                if (!r.ok) return void toast.error(r.message);
                onSaved();
              });
            }}><Trash2 className="h-4 w-4" /> Delete</Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={pending || !name.trim()} onClick={save}>{group ? "Save" : "Create group"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
