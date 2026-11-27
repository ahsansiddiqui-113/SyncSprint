"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { BookmarkPlus, ChevronDown, FileStack, Loader2, Trash2 } from "lucide-react";
import { createTaskFromTemplateAction, deleteTaskTemplateAction, listTaskTemplatesAction, saveProjectAsTemplateAction, saveTaskTemplateAction } from "@/actions/growth.actions";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { todayISO } from "@/lib/dates";

type Row = { id: string; name: string; payload: { title: string; checklist: string[]; subtasks: string[] }; createdById: string | null };

/** "From template" next to Add Task: pick a task template, get the task with its checklist, tags and subtasks. */
export function TaskTemplatesButton({ organizationId, projectId, meId, isAdmin, onCreated }: { organizationId: string; projectId: string; meId: string; isAdmin: boolean; onCreated: (taskId: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await listTaskTemplatesAction(organizationId, projectId);
    setRows(r.ok ? r.templates : []);
  }, [organizationId, projectId]);

  return (
    <Popover
      align="right"
      onOpenChange={(open) => open && void load()}
      trigger={() => (
        <Button variant="outline" size="sm" aria-label="New task from a template" title="New task from a template">
          <FileStack className="h-4 w-4" /> <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      )}
    >
      <div className="w-72">
        <div className="px-3 pb-1 pt-1.5 text-[12px] font-semibold uppercase tracking-wide text-subtle">New task from template</div>
        {rows === null ? (
          <div className="px-3 py-3"><Loader2 className="h-4 w-4 animate-spin text-subtle" /></div>
        ) : rows.length === 0 ? (
          <p className="px-3 py-2 text-[13.5px] text-muted">No templates yet. Open a task and choose <b>Save as template</b> to make one (a bug report, a release checklist…).</p>
        ) : (
          rows.map((t) => (
            <div key={t.id} className="group flex items-center gap-1">
              <button
                disabled={!!busy}
                onClick={async () => {
                  setBusy(t.id);
                  const r = await createTaskFromTemplateAction(organizationId, t.id, null, todayISO());
                  setBusy(null);
                  if (!r.ok) return void toast.error(r.message);
                  onCreated(r.taskId);
                }}
                className="flex min-w-0 flex-1 cursor-pointer flex-col rounded-lg px-3 py-2 text-left hover:bg-hover"
              >
                <span className="flex items-center gap-2 truncate text-[14.5px] font-medium">{busy === t.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{t.name}</span>
                <span className="truncate text-[12.5px] text-subtle">
                  {t.payload.checklist.length ? `${t.payload.checklist.length} checklist items` : "No checklist"}{t.payload.subtasks.length ? ` · ${t.payload.subtasks.length} subtasks` : ""}
                </span>
              </button>
              {(t.createdById === meId || isAdmin) && (
                <button aria-label={`Delete template ${t.name}`} onClick={async () => {
                  if (!window.confirm(`Delete the template "${t.name}"?`)) return;
                  const r = await deleteTaskTemplateAction(organizationId, t.id);
                  if (!r.ok) return void toast.error(r.message);
                  void load();
                }} className="cursor-pointer rounded p-1.5 text-subtle opacity-0 hover:bg-hover hover:text-rose-600 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </Popover>
  );
}

/** Drawer action: save this task (checklist, tags, subtasks) as a reusable template. */
export function SaveTaskTemplateButton({ organizationId, taskId, title }: { organizationId: string; taskId: string; title: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="ghost" size="sm" disabled={busy} title="Reuse this task's checklist, tags and subtasks" onClick={async () => {
      const name = window.prompt("Template name", title.slice(0, 80));
      if (!name?.trim()) return;
      setBusy(true);
      const r = await saveTaskTemplateAction(organizationId, taskId, name.trim());
      setBusy(false);
      if (!r.ok) return void toast.error(r.message);
      toast.success(`Saved "${name.trim()}". Use it from the template button next to Add Task.`);
    }}>
      <BookmarkPlus className="h-3.5 w-3.5" /> Save as template
    </Button>
  );
}

/** Project menu (admins): save statuses, fields and (optionally) tasks as a workspace template. */
export async function saveProjectTemplateFlow(organizationId: string, projectId: string, projectName: string) {
  const name = window.prompt("Template name", `${projectName} template`);
  if (!name?.trim()) return;
  const includeTasks = window.confirm("Include this project's tasks (with checklists and subtasks) as starter tasks?\n\nOK = include tasks · Cancel = statuses and fields only");
  const r = await saveProjectAsTemplateAction(organizationId, projectId, name.trim(), null, includeTasks);
  if (!r.ok) return void toast.error(r.message);
  toast.success(`Template "${name.trim()}" saved. Pick it when creating a new project.`);
}
