"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Clock, Columns3, Flag, GitMerge, Loader2, MessageSquare, Plus, Send, Sparkles, Trash2, UserRound, Wand2 } from "lucide-react";
import type { TaskPriority } from "@/db/schema";
import type { PresenceUser, TaskDTO } from "@/lib/realtime-protocol";
import { can } from "@/lib/rbac-shared";
import { cn, timeAgo } from "@/lib/utils";
import { addCommentAction, deleteTaskAction, listCommentsAction, updateTaskAction } from "@/actions/task.actions";
import { createSubtasksAction, decomposeTaskAction, explainConflictAction } from "@/actions/ai.actions";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PRIORITY_STYLE, PriorityIcon } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Section, Sheet } from "./sheet";
import type { BoardCtx } from "./kanban-board";

type Comment = { id: string; body: string; createdAt: string; authorName: string | null; authorId: string | null };
type Subtask = { title: string; priority: TaskPriority; estimatedPoints: number };

export function TaskDrawer(props: {
  ctx: BoardCtx;
  task: TaskDTO;
  viewers: PresenceUser[];
  commentsVersion: number;
  onClose: () => void;
  onEditingChange: (editing: boolean) => void;
  onServerTask: (t: TaskDTO) => void;
  onForceTask: (t: TaskDTO) => void;
  onRemoved: (id: string) => void;
  onCreated: (ts: TaskDTO[]) => void;
}) {
  const { ctx, task } = props;
  const canEdit = can(ctx.role, "CREATE_OR_MOVE_TASK");
  // Edits are made against the version we started from (`base`), not the live one.
  const [base, setBase] = useState(task);
  const [draft, setDraft] = useState({ title: task.title, description: task.description ?? "", priority: task.priority, assigneeId: task.assigneeId ?? "" });
  const [pending, start] = useTransition();
  const [comments, setComments] = useState<Comment[]>([]);
  const [comment, setComment] = useState("");
  const [subtasks, setSubtasks] = useState<{ items: Subtask[]; provider: string; note?: string } | null>(null);
  const [aiPending, startAi] = useTransition();

  const dirty =
    draft.title !== base.title ||
    draft.description !== (base.description ?? "") ||
    draft.priority !== base.priority ||
    draft.assigneeId !== (base.assigneeId ?? "");
  const remoteChanged = task.version > base.version;

  useEffect(() => props.onEditingChange(dirty), [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up teammates' changes silently when we have no local edits.
  useEffect(() => {
    if (!dirty && remoteChanged) {
      setBase(task);
      setDraft({ title: task.title, description: task.description ?? "", priority: task.priority, assigneeId: task.assigneeId ?? "" });
    }
  }, [task, dirty, remoteChanged]);

  useEffect(() => {
    listCommentsAction(ctx.org.id, task.id).then((r) => r.ok && setComments(r.comments));
  }, [ctx.org.id, task.id, props.commentsVersion]);

  function save() {
    start(async () => {
      const patch: Record<string, unknown> = {};
      if (draft.title !== base.title) patch.title = draft.title;
      if (draft.description !== (base.description ?? "")) patch.description = draft.description || null;
      if (draft.priority !== base.priority) patch.priority = draft.priority;
      if (draft.assigneeId !== (base.assigneeId ?? "")) patch.assigneeId = draft.assigneeId || null;
      const res = await updateTaskAction({ organizationId: ctx.org.id, taskId: task.id, expectedVersion: base.version, patch });
      if (!res.ok) return void toast.error(res.message);
      if (res.conflict) {
        if (res.current) {
          props.onForceTask(res.current);
          setBase(res.current);
        }
        const exp = await explainConflictAction(ctx.org.id, task.id, base.version);
        toast.warning(`Not saved — ${exp.ok ? exp.summary : "a teammate changed this card first."} Your edits are kept; review and save again.`, { duration: 8000 });
        return;
      }
      props.onServerTask(res.task);
      setBase(res.task);
      toast.success("Saved");
    });
  }

  const ref = `${ctx.project.key}-${task.taskNumber}`;
  const column = ctx.columns.find((c) => c.id === task.columnId);
  const reset = () => {
    setBase(task);
    setDraft({ title: task.title, description: task.description ?? "", priority: task.priority, assigneeId: task.assigneeId ?? "" });
  };

  return (
    <Sheet
      onClose={props.onClose}
      title={
        <span className="flex items-center gap-2.5 text-sm">
          <span className="rounded-md border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[14px] text-muted">{ref}</span>
          <span className="text-subtle">in</span>
          <span className="font-medium">{column?.title}</span>
          <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[12.5px] font-normal text-subtle" title="Optimistic-lock version">
            v{task.version}
          </span>
        </span>
      }
      footer={
        canEdit ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-rose-700/80 hover:bg-rose-500/10 hover:text-rose-700"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (!confirm(`Delete ${ref}? This cannot be undone.`)) return;
                  const res = await deleteTaskAction(ctx.org.id, task.id);
                  if (!res.ok) return void toast.error(res.message);
                  props.onRemoved(task.id);
                })
              }
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
            <span className="ml-auto text-[14px] text-subtle">{dirty ? "Unsaved changes" : "All changes saved"}</span>
            {dirty && (
              <Button variant="ghost" size="sm" onClick={reset} disabled={pending}>
                Discard
              </Button>
            )}
            <Button size="sm" onClick={save} disabled={!dirty || pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save changes
            </Button>
          </div>
        ) : (
          <p className="text-[14px] text-subtle">Viewing as viewer — read-only.</p>
        )
      }
    >
      {props.viewers.length > 0 && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-violet-400/25 bg-violet-400/[0.07] px-3 py-2.5 text-[15px] text-violet-800">
          <div className="flex -space-x-1.5">
            {props.viewers.slice(0, 3).map((v) => <Avatar key={v.connectionId} id={v.userId} name={v.name} size={22} ring />)}
          </div>
          <span>
            <b className="font-medium">{props.viewers.map((v) => v.name.split(" ")[0]).join(", ")}</b>{" "}
            {props.viewers.some((v) => v.editing) ? "is editing this card right now" : "also has this card open"}
          </span>
          <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
        </div>
      )}
      {remoteChanged && dirty && (
        <div className="mb-4 flex gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.08] px-3.5 py-3 text-[15px] text-amber-900">
          <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            A teammate saved this card (v{base.version} → v{task.version}) while you were editing. Saving now will be rejected with{" "}
            <code className="rounded bg-surface-2 px-1 font-mono text-[13.5px]">VERSION_CONFLICT</code>.
            <button className="ml-1 cursor-pointer font-medium text-amber-700 underline underline-offset-2" onClick={reset}>
              Load their version
            </button>
          </div>
        </div>
      )}

      <fieldset disabled={!canEdit || pending}>
        <textarea
          aria-label="Title"
          value={draft.title}
          maxLength={200}
          rows={2}
          onChange={(e) => setDraft({ ...draft, title: e.target.value.replace(/\n/g, " ") })}
          className="w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-1 text-xl font-semibold leading-snug tracking-tight outline-none transition-colors hover:border-border focus:border-primary/50 focus:bg-surface-2"
        />

        <div className="mt-4 grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2.5 rounded-xl border border-border bg-surface-2 p-3.5 text-sm">
          <span className="flex items-center gap-2 text-[15px] text-subtle"><Columns3 className="h-3.5 w-3.5" /> Status</span>
          <span className="text-[15px] font-medium">{column?.title}</span>

          <span className="flex items-center gap-2 text-[15px] text-subtle"><Flag className="h-3.5 w-3.5" /> Priority</span>
          <div className="flex gap-1">
            {(["low", "medium", "high", "urgent"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDraft({ ...draft, priority: p })}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[14px] capitalize transition-colors disabled:cursor-default",
                  draft.priority === p ? PRIORITY_STYLE[p].badge : "border-transparent text-subtle hover:bg-hover hover:text-foreground"
                )}
              >
                <PriorityIcon priority={p} className="scale-75" /> {p}
              </button>
            ))}
          </div>

          <span className="flex items-center gap-2 text-[15px] text-subtle"><UserRound className="h-3.5 w-3.5" /> Assignee</span>
          <Select aria-label="Assignee" className="h-8 max-w-60 border-transparent bg-transparent px-1.5 hover:border-border-strong" value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })}>
            <option value="">Unassigned</option>
            {ctx.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>

          <span className="flex items-center gap-2 text-[15px] text-subtle"><Clock className="h-3.5 w-3.5" /> Updated</span>
          <span className="text-[15px] text-muted">{timeAgo(task.updatedAt)} · created {timeAgo(task.createdAt)}</span>
        </div>

        <Section title="Description" className="mt-6">
          <Textarea aria-label="Description" rows={6} value={draft.description} placeholder="Add context, acceptance criteria, links… (markdown)" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Section>
      </fieldset>

      {canEdit && (
        <section className="relative mt-7 overflow-hidden rounded-xl border border-primary/25 bg-linear-to-br from-primary/[0.10] via-transparent to-accent/[0.06] p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary"><Sparkles className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">Break into subtasks</h3>
              <p className="text-[14px] text-muted">AI drafts 3–6 actionable subtasks with story points.</p>
            </div>
            <Button
              size="sm"
              variant="ai"
              disabled={aiPending}
              onClick={() =>
                startAi(async () => {
                  const r = await decomposeTaskAction(ctx.org.id, task.id);
                  if (!r.ok) return void toast.error(r.message);
                  setSubtasks({ items: r.subtasks, provider: r.provider, note: r.fallbackReason });
                })
              }
            >
              {aiPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} {subtasks ? "Regenerate" : "Generate"}
            </Button>
          </div>
          {subtasks && (
            <div className="mt-4 animate-fade-up">
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-2">
                {subtasks.items.map((s, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2 text-[15px]">
                    <PriorityIcon priority={s.priority} />
                    <span className="flex-1">{s.title}</span>
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-muted">{s.estimatedPoints} pts</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[13px] text-subtle">
                  via <span className="font-mono">{subtasks.provider}</span>
                  {subtasks.note ? ` · ${subtasks.note}` : ""}
                </span>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={aiPending}
                  onClick={() =>
                    startAi(async () => {
                      const r = await createSubtasksAction(ctx.org.id, task.id, subtasks.items);
                      if (!r.ok) return void toast.error(r.message);
                      props.onCreated(r.tasks);
                      setSubtasks(null);
                      toast.success(`Added ${r.tasks.length} subtasks to ${ctx.columns[0]?.title ?? "the board"}`);
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add all to {ctx.columns[0]?.title}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <Section title={`Comments · ${comments.length}`} icon={<MessageSquare className="h-3.5 w-3.5 text-subtle" />}>
        <div className="space-y-4">
          {comments.length === 0 && <p className="text-[15px] text-subtle">No comments yet — start the discussion.</p>}
          {comments.map((c) => (
            <div key={c.id} className="flex gap-3">
              <Avatar id={c.authorId ?? "x"} name={c.authorName ?? "Deleted user"} size={26} />
              <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-border bg-elevated px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[15px] font-medium">{c.authorName ?? "Deleted user"}</span>
                  <span className="text-[13px] text-subtle">{timeAgo(c.createdAt)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
        {can(ctx.role, "COMMENT") && (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const body = comment.trim();
              if (!body) return;
              start(async () => {
                const r = await addCommentAction(ctx.org.id, task.id, body);
                if (!r.ok) return void toast.error(r.message);
                setComments((cs) => [...cs, r.comment]);
                setComment("");
              });
            }}
          >
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment…" maxLength={5000} />
            <Button variant="subtle" disabled={pending || !comment.trim()} aria-label="Send comment">
              <Send className="h-3.5 w-3.5" />
            </Button>
          </form>
        )}
      </Section>
    </Sheet>
  );
}
