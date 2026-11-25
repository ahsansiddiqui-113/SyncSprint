"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, Hash, ListChecks, Lock, Plus, Trash2, Type, UserRound, X } from "lucide-react";
import type { ProjectMeta } from "@/server/services/breakdown";
import { TAG_COLORS } from "@/lib/tag-colors";
import { cn } from "@/lib/utils";
import {
  addStatusAction,
  createFieldAction,
  deleteFieldAction,
  deleteStatusAction,
  moveStatusAction,
  updateFieldAction,
  updateStatusAction,
} from "@/actions/customize.actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { Sheet, Section } from "./sheet";
import type { Column } from "./kanban-board";

const FIELD_TYPES = [
  { id: "text", label: "Text", icon: Type },
  { id: "number", label: "Number", icon: Hash },
  { id: "select", label: "Dropdown", icon: ListChecks },
  { id: "date", label: "Date", icon: CalendarDays },
  { id: "person", label: "Person", icon: UserRound },
] as const;

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <Popover
      trigger={() => (
        <button type="button" aria-label="Change color" className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border hover:border-border-strong">
          <span className="h-4 w-4 rounded" style={{ backgroundColor: value }} />
        </button>
      )}
      className="w-auto min-w-0"
    >
      <div className="grid grid-cols-4 gap-1.5 p-1">
        {TAG_COLORS.map((c) => (
          <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => onChange(c)} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-white" style={{ backgroundColor: c }}>
            {value === c && <Check className="h-4 w-4" />}
          </button>
        ))}
      </div>
    </Popover>
  );
}

export function CustomizePanel({
  organizationId,
  projectId,
  columns,
  colorOf,
  meta,
  onClose,
  onChanged,
}: {
  organizationId: string;
  projectId: string;
  columns: Column[];
  colorOf: (i: number) => string;
  meta: ProjectMeta;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const [newStatus, setNewStatus] = useState("");
  const [newStatusColor, setNewStatusColor] = useState<string>(TAG_COLORS[5]);
  const [deleting, setDeleting] = useState<Column | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<(typeof FIELD_TYPES)[number]["id"]>("text");
  const [options, setOptions] = useState<{ label: string; color: string }[]>([{ label: "", color: TAG_COLORS[0] }]);
  const [editingField, setEditingField] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, ok?: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message ?? "Something went wrong");
      if (ok) toast.success(ok);
      after?.();
      onChanged();
    });

  return (
    <Sheet title="Customize project" onClose={onClose}>
      {/* ------------------------------ statuses ------------------------------ */}
      <Section title="Statuses" className="mt-0">
        <p className="mb-3 text-[14px] text-muted">The last status always means <b>Done</b> — it counts toward progress, sprints and dashboards.</p>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {columns.map((c, i) => {
            const isDone = i === columns.length - 1;
            return (
              <StatusRow
                key={c.id}
                column={c}
                color={c.color ?? colorOf(i)}
                isDone={isDone}
                canLeft={!isDone && i > 0}
                canRight={!isDone && i < columns.length - 2}
                pending={pending}
                onRename={(title) => run(() => updateStatusAction(organizationId, c.id, { title }), "Status renamed")}
                onColor={(color) => run(() => updateStatusAction(organizationId, c.id, { color }))}
                onMove={(dir) => run(() => moveStatusAction(organizationId, c.id, dir))}
                onDelete={() => {
                  setDeleting(c);
                  setMoveTo(columns.find((x) => x.id !== c.id)?.id ?? "");
                }}
              />
            );
          })}
        </div>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const t = newStatus.trim();
            if (!t) return;
            run(() => addStatusAction(organizationId, projectId, t, newStatusColor), `Added “${t}” before Done`, () => setNewStatus(""));
          }}
        >
          <ColorPicker value={newStatusColor} onChange={setNewStatusColor} />
          <Input value={newStatus} onChange={(e) => setNewStatus(e.target.value)} maxLength={40} placeholder="New status, e.g. QA" aria-label="New status name" className="h-9" />
          <Button size="sm" disabled={pending || !newStatus.trim()}><Plus className="h-4 w-4" /> Add</Button>
        </form>
      </Section>

      {/* ------------------------------- fields ------------------------------- */}
      <Section title="Custom fields">
        {meta.fields.length === 0 && <p className="mb-3 text-[14px] text-subtle">No custom fields yet. Add one to track anything — like Team, Customer or Release.</p>}
        <div className="space-y-2">
          {meta.fields.map((f) => {
            const T = FIELD_TYPES.find((x) => x.id === f.type)!;
            const open = editingField === f.id;
            return (
              <div key={f.id} className="rounded-xl border border-border">
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <T.icon className="h-4 w-4 text-subtle" />
                  <span className="flex-1 font-medium">{f.name}</span>
                  <span className="text-[13px] text-subtle">{T.label}{f.type === "select" ? ` · ${f.options.length} options` : ""}</span>
                  <button onClick={() => setEditingField(open ? null : f.id)} aria-label={`Edit ${f.name}`} className="cursor-pointer rounded p-1 text-subtle hover:bg-hover hover:text-foreground">
                    <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
                  </button>
                  <button
                    aria-label={`Delete ${f.name}`}
                    disabled={pending}
                    onClick={() => confirm(`Delete the “${f.name}” field? Its values on every task are removed.`) && run(() => deleteFieldAction(organizationId, f.id), "Field deleted")}
                    className="cursor-pointer rounded p-1 text-subtle hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {open && (
                  <FieldEditForm
                    field={f}
                    pending={pending}
                    onSave={(input) => run(() => updateFieldAction(organizationId, f.id, input), "Field updated", () => setEditingField(null))}
                  />
                )}
              </div>
            );
          })}
        </div>

        <form
          className="mt-4 space-y-3 rounded-xl border border-dashed border-border-strong p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = fieldName.trim();
            if (!name) return;
            const opts = options.filter((o) => o.label.trim()).map((o) => ({ label: o.label.trim(), color: o.color }));
            run(
              () => createFieldAction(organizationId, projectId, { name, type: fieldType, options: fieldType === "select" ? opts : [] }),
              `Added the “${name}” field`,
              () => {
                setFieldName("");
                setOptions([{ label: "", color: TAG_COLORS[0] }]);
              }
            );
          }}
        >
          <div className="text-[14px] font-semibold">New field</div>
          <div className="grid grid-cols-[1fr_160px] gap-2">
            <Input value={fieldName} onChange={(e) => setFieldName(e.target.value)} maxLength={60} placeholder="Field name" aria-label="Field name" />
            <Select value={fieldType} onChange={(e) => setFieldType(e.target.value as typeof fieldType)} aria-label="Field type">
              {FIELD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </div>
          {fieldType === "select" && <OptionsEditor options={options} onChange={setOptions} />}
          <div className="flex justify-end">
            <Button size="sm" disabled={pending || !fieldName.trim() || (fieldType === "select" && !options.some((o) => o.label.trim()))}>
              <Plus className="h-4 w-4" /> Add field
            </Button>
          </div>
        </form>
      </Section>

      {deleting && (
        <Sheet side="center" title={`Delete “${deleting.title}”`} onClose={() => setDeleting(null)}>
          <p className="text-[15px]">Tasks in this status will move to:</p>
          <Select className="mt-3" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move tasks to">
            {columns.filter((c) => c.id !== deleting.id).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={pending || !moveTo}
              onClick={() => run(() => deleteStatusAction(organizationId, deleting.id, moveTo), `Deleted “${deleting.title}”`, () => setDeleting(null))}
            >
              <Trash2 className="h-4 w-4" /> Delete status
            </Button>
          </div>
        </Sheet>
      )}
    </Sheet>
  );
}

function StatusRow(props: {
  column: Column;
  color: string;
  isDone: boolean;
  canLeft: boolean;
  canRight: boolean;
  pending: boolean;
  onRename: (t: string) => void;
  onColor: (c: string) => void;
  onMove: (dir: "left" | "right") => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(props.column.title);
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <ColorPicker value={props.color} onChange={props.onColor} />
      <input
        value={title}
        maxLength={40}
        aria-label="Status name"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title.trim() !== props.column.title && props.onRename(title.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 min-w-0 flex-1 rounded-md border border-transparent px-2 text-[15px] font-medium outline-none hover:border-border-strong focus:border-primary"
      />
      {props.isDone ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[12.5px] font-semibold text-emerald-700"><Lock className="h-3.5 w-3.5" /> Done</span>
      ) : (
        <>
          <button disabled={!props.canLeft || props.pending} onClick={() => props.onMove("left")} aria-label="Move earlier" className="cursor-pointer rounded p-1 text-subtle hover:bg-hover disabled:cursor-default disabled:opacity-30"><ArrowLeft className="h-4 w-4" /></button>
          <button disabled={!props.canRight || props.pending} onClick={() => props.onMove("right")} aria-label="Move later" className="cursor-pointer rounded p-1 text-subtle hover:bg-hover disabled:cursor-default disabled:opacity-30"><ArrowRight className="h-4 w-4" /></button>
          <button disabled={props.pending} onClick={props.onDelete} aria-label={`Delete ${props.column.title}`} className="cursor-pointer rounded p-1 text-subtle hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </>
      )}
    </div>
  );
}

function OptionsEditor({ options, onChange }: { options: { id?: string; label: string; color: string }[]; onChange: (o: { id?: string; label: string; color: string }[]) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>Options</Label>
      {options.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <ColorPicker value={o.color} onChange={(c) => onChange(options.map((x, j) => (j === i ? { ...x, color: c } : x)))} />
          <Input value={o.label} maxLength={40} placeholder={`Option ${i + 1}`} aria-label={`Option ${i + 1}`} onChange={(e) => onChange(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-9" />
          <button type="button" aria-label="Remove option" disabled={options.length === 1} onClick={() => onChange(options.filter((_, j) => j !== i))} className="cursor-pointer rounded p-1 text-subtle hover:text-red-600 disabled:opacity-30">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...options, { label: "", color: TAG_COLORS[(options.length + 1) % TAG_COLORS.length]! }])} className="inline-flex cursor-pointer items-center gap-1 text-[14px] font-medium text-primary">
        <Plus className="h-4 w-4" /> Add option
      </button>
    </div>
  );
}

function FieldEditForm({ field, pending, onSave }: { field: ProjectMeta["fields"][number]; pending: boolean; onSave: (i: { name?: string; options?: { id?: string; label: string; color: string }[] }) => void }) {
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState<{ id?: string; label: string; color: string }[]>(field.options.map((o) => ({ ...o })));
  return (
    <div className="space-y-3 border-t border-border px-3 py-3">
      <div className="space-y-1.5">
        <Label htmlFor={`fn-${field.id}`}>Name</Label>
        <Input id={`fn-${field.id}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className="h-9" />
      </div>
      {field.type === "select" && (
        <>
          <OptionsEditor options={options} onChange={setOptions} />
          <p className="text-[13px] text-subtle">Removing an option clears it from tasks that use it.</p>
        </>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={pending || !name.trim()}
          onClick={() => onSave({ name: name.trim(), ...(field.type === "select" ? { options: options.filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() })) } : {}) })}
        >
          Save field
        </Button>
      </div>
    </div>
  );
}
