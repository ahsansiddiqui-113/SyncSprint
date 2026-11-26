"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, FileUp, Loader2, Upload } from "lucide-react";
import type { ImportPreview } from "@/server/services/import-export";
import type { TaskDTO } from "@/lib/realtime-protocol";
import { can } from "@/lib/rbac-shared";
import { cn } from "@/lib/utils";
import { commitImportAction, exportProjectCsvAction, previewImportAction } from "@/actions/automation.actions";
import { Button } from "@/components/ui/button";
import { Sheet, Section } from "./sheet";
import type { BoardCtx } from "./kanban-board";

export function ImportExportPanel({ ctx, onClose, onImported }: { ctx: BoardCtx; onClose: () => void; onImported: (tasks: TaskDTO[]) => void }) {
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const canImport = can(ctx.role, "CREATE_OR_MOVE_TASK");

  const load = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) return void toast.error("The file is larger than 2 MB");
    const text = await file.text();
    setCsv({ name: file.name, text });
    setPreview(null);
    start(async () => {
      const r = await previewImportAction(ctx.org.id, ctx.project.id, text);
      if (!r.ok) return void toast.error(r.message);
      setPreview(r.preview);
    });
  };

  const exportCsv = () =>
    start(async () => {
      const r = await exportProjectCsvAction(ctx.org.id, ctx.project.id);
      if (!r.ok) return void toast.error(r.message);
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: r.filename });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Exported ${r.count} task${r.count === 1 ? "" : "s"}`);
    });

  const warnings = preview?.rows.reduce((s, r) => s + r.warnings.length, 0) ?? 0;

  return (
    <Sheet title={`Import & export · ${ctx.project.name}`} onClose={onClose}>
      <Section title="Export" className="mt-0">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-elevated p-4">
          <p className="min-w-0 flex-1 text-[15px] text-muted">Every task in this project as CSV: status, people, points, estimates, dates, sprint, labels and parent. Opens in Excel, Google Sheets or Numbers.</p>
          <Button variant="outline" disabled={pending} onClick={exportCsv}>
            <Download className="h-4 w-4" /> Download CSV
          </Button>
        </div>
      </Section>

      {canImport && (
        <Section title="Import from CSV or Jira">
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => (e.target.files?.[0] && void load(e.target.files[0]), (e.target.value = ""))} />
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => (e.preventDefault(), setDrag(true))}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void load(f);
            }}
            className={cn(
              "flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border-strong px-6 py-8 text-center transition hover:border-primary/50",
              drag && "border-primary bg-primary-soft"
            )}
          >
            <FileUp className="h-8 w-8 text-primary" />
            <span className="font-medium">{csv ? csv.name : "Choose a CSV file or drop it here"}</span>
            <span className="text-[14px] text-subtle">Jira “Export → CSV (all fields)”, a SyncSprint export, or any sheet with a Summary/Title column · up to 1,000 rows</span>
          </button>

          {pending && !preview && (
            <p className="mt-4 flex items-center gap-2 text-[15px] text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Reading the file…</p>
          )}

          {preview && (
            <div className="mt-5 animate-fade-up">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14.5px]">
                <b>{preview.rows.length} task{preview.rows.length === 1 ? "" : "s"} ready</b>
                {preview.skipped.length > 0 && <span className="text-muted">{preview.skipped.length} row{preview.skipped.length === 1 ? "" : "s"} skipped (no title)</span>}
                {warnings > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-4 w-4" /> {warnings} adjustment{warnings === 1 ? "" : "s"} — review below</span>}
                {preview.newLabels.length > 0 && <span className="text-muted">New tags: {preview.newLabels.slice(0, 6).join(", ")}{preview.newLabels.length > 6 ? "…" : ""}</span>}
              </div>
              <p className="mt-2 text-[13.5px] text-subtle">
                Columns used: {preview.mapped.filter((m) => m.field).map((m) => m.header).join(", ")}
                {preview.mapped.some((m) => !m.field) && <> · ignored: {preview.mapped.filter((m) => !m.field).map((m) => m.header).slice(0, 8).join(", ")}</>}
              </p>
              <div className="mt-3 max-h-[46vh] overflow-auto rounded-xl border border-border">
                <table className="w-full text-left text-[14px]">
                  <thead className="sticky top-0 bg-surface-2 text-[12.5px] uppercase tracking-wide text-subtle">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Title</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Type</th>
                      <th className="px-3 py-2 font-semibold">Priority</th>
                      <th className="px-3 py-2 font-semibold">Assignee</th>
                      <th className="px-3 py-2 font-semibold">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 200).map((r) => (
                      <tr key={r.line} className="border-t border-border align-top">
                        <td className="px-3 py-2">
                          <div className="font-medium">{r.parentKey && <span className="mr-1 text-subtle">↳</span>}{r.title}</div>
                          {r.warnings.map((w, i) => (
                            <div key={i} className="mt-0.5 flex items-start gap-1 text-[12.5px] text-amber-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</div>
                          ))}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.status}</td>
                        <td className="px-3 py-2 capitalize">{r.type}</td>
                        <td className="px-3 py-2 capitalize">{r.priority}</td>
                        <td className="px-3 py-2">{r.assigneeName ?? <span className="text-subtle">—</span>}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.dueDate ?? <span className="text-subtle">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.rows.length > 200 && <p className="border-t border-border px-3 py-2 text-[13px] text-subtle">…and {preview.rows.length - 200} more</p>}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => (setPreview(null), setCsv(null))}>Cancel</Button>
                <Button
                  disabled={pending || !preview.rows.length}
                  onClick={() =>
                    start(async () => {
                      const r = await commitImportAction(ctx.org.id, ctx.project.id, csv!.text);
                      if (!r.ok) return void toast.error(r.message);
                      onImported(r.tasks);
                      toast.success(`Imported ${r.count} task${r.count === 1 ? "" : "s"} into ${ctx.project.name}`);
                      onClose();
                    })
                  }
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import {preview.rows.length} task{preview.rows.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>
          )}
        </Section>
      )}
    </Sheet>
  );
}
