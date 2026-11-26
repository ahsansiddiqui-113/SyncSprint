"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Wand2 } from "lucide-react";
import type { TaskPriority } from "@/db/schema";
import type { TaskDTO } from "@/lib/realtime-protocol";
import { createTaskAction } from "@/actions/task.actions";
import { triageTaskAction } from "@/actions/ai.actions";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Sheet } from "./sheet";
import { PRIORITY_STYLE } from "@/components/ui/badge";
import type { WorkItemType } from "@/db/schema";
import type { SprintDTO } from "@/server/services/sprints";
import { TYPE_META, WORK_ITEM_TYPES } from "./task-meta";
import { loadHint, type WeekLoad } from "./views/table-view";
import type { CapacityWarning } from "@/server/services/capacity";
import { cn } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import { aiSourceLabel } from "@/lib/ai-label";
import type { BoardCtx } from "./kanban-board";

export function NewTaskDialog({
  ctx,
  initialColumnId,
  initialDueDate,
  sprints,
  weekLoad,
  onWarnings,
  onClose,
  onCreated,
}: {
  ctx: BoardCtx;
  initialColumnId?: string;
  initialDueDate?: string;
  sprints: SprintDTO[];
  weekLoad: WeekLoad;
  onWarnings: (w: CapacityWarning[] | undefined) => void;
  onClose: () => void;
  onCreated: (t: TaskDTO) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [columnId, setColumnId] = useState(initialColumnId ?? ctx.columns[0]?.id ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [estimate, setEstimate] = useState("");
  // Pre-assignment heads-up (non-blocking): this week's load + this estimate vs capacity.
  const load = assigneeId ? weekLoad.get(assigneeId) : undefined;
  const est = Number(estimate) || 0;
  const projected = load ? load.load + est : 0;
  const capacityNote =
    load && load.capacity > 0 && (load.status === "over" || projected > load.capacity)
      ? { level: "over" as const, text: `${ctx.members.find((m) => m.id === assigneeId)?.name ?? "This person"} would be over capacity this week: ${Math.round(projected * 10) / 10}h of ${load.capacity}h.` }
      : load && load.capacity > 0 && (load.status === "near" || projected >= load.capacity * 0.85)
        ? { level: "near" as const, text: `${ctx.members.find((m) => m.id === assigneeId)?.name ?? "This person"} is near capacity this week: ${Math.round(projected * 10) / 10}h of ${load.capacity}h.` }
        : null;
  const [dueDate, setDueDate] = useState(initialDueDate ?? "");
  const [points, setPoints] = useState("");
  const [type, setType] = useState<WorkItemType>("task");
  const [sprintId, setSprintId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [triage, setTriage] = useState<{ rationale: string; provider: string; labels: string[] } | null>(null);
  const [pending, start] = useTransition();
  const [aiPending, startAi] = useTransition();

  return (
    <Sheet side="center" title="New task" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await createTaskAction({
              organizationId: ctx.org.id,
              columnId,
              title,
              description: description || null,
              priority,
              assigneeId: assigneeId || null,
              dueDate: dueDate || null,
              storyPoints: points === "" ? null : Number(points),
              estimateHours: estimate === "" ? null : Math.round(Number(estimate) * 4) / 4,
              type,
              sprintId: sprintId || null,
              teamId: teamId || null,
            }, todayISO());
            if (!r.ok) return void toast.error(r.message);
            onCreated(r.task);
            onWarnings(r.warnings);
            toast.success(`Created ${ctx.project.key}-${r.task.taskNumber}`);
            onClose();
          });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="n-title">Title</Label>
          <Input id="n-title" autoFocus required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Checkout page crashes for EU customers" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="n-desc">Description</Label>
          <Textarea id="n-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="rounded-md border border-dashed border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">Let AI suggest priority & starting column (you can override).</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!title.trim() || aiPending}
              onClick={() =>
                startAi(async () => {
                  const r = await triageTaskAction(ctx.org.id, ctx.project.id, title, description);
                  if (!r.ok) return void toast.error(r.message);
                  setPriority(r.suggestion.priority);
                  setColumnId(r.suggestion.columnId);
                  setTriage({ rationale: r.suggestion.rationale, provider: r.provider, labels: r.suggestion.labels });
                })
              }
            >
              {aiPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} AI triage
            </Button>
          </div>
          {triage && (
            <p className="mt-2 text-xs">
              {triage.rationale}
              {triage.labels.length > 0 && <span className="text-muted"> · labels: {triage.labels.join(", ")}</span>}
              <span className="text-muted"> · {aiSourceLabel(triage.provider)}</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="n-pri">Priority</Label>
            <Select id="n-pri" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {(["urgent", "high", "medium", "low"] as const).map((p) => <option key={p} value={p}>{PRIORITY_STYLE[p].label}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-col">Column</Label>
            <Select id="n-col" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {ctx.columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-asg">Assignee</Label>
            <Select id="n-asg" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {ctx.members.map((m) => <option key={m.id} value={m.id}>{m.name}{loadHint(m.id, weekLoad)}</option>)}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="n-type">Type</Label>
            <Select id="n-type" value={type} onChange={(e) => setType(e.target.value as WorkItemType)}>
              {WORK_ITEM_TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-sprint">Sprint</Label>
            <Select id="n-sprint" value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
              <option value="">Backlog</option>
              {sprints.filter((s) => s.status !== "completed").map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.status === "active" ? " (active)" : ""}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-team">Group</Label>
            <Select id="n-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">No group</option>
              {ctx.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="n-est">Estimate (h)</Label>
            <Input id="n-est" type="number" min={0} max={1000} step={0.25} value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="—" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-due">Due date</Label>
            <Input id="n-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="n-pts">Story points</Label>
            <Select id="n-pts" value={points} onChange={(e) => setPoints(e.target.value)}>
              <option value="">—</option>
              {[1, 2, 3, 5, 8, 13].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </div>
        </div>
        {capacityNote && (
          <div
            role="status"
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-[14px]",
              capacityNote.level === "over" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"
            )}
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {capacityNote.text} You can still create the task — consider another assignee or a later due date.
            </span>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || !title.trim()}>{pending ? "Creating…" : "Create task"}</Button>
        </div>
      </form>
    </Sheet>
  );
}
