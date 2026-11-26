"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, Play, Plus, Send, Square, Timer, Trash2, Upload, X } from "lucide-react";
import type { TaskDTO } from "@/lib/realtime-protocol";
import { can, hasRole } from "@/lib/rbac-shared";
import { cn, timeAgo } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import { activeMentionQuery, encodeMentions, parseDuration, parseMentions } from "@/lib/mentions";
import {
  addTimeEntryAction,
  deleteAttachmentAction,
  deleteTimeEntryAction,
  docsForTaskAction,
  listAttachmentsAction,
  startTimerAction,
  stopTimerAction,
  taskTimeAction,
} from "@/actions/collab.actions";
import { setRecurrenceAction } from "@/actions/automation.actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { elapsedClock, emitSignal, formatMinutes, useSignal } from "@/components/workspace/signals";
import { Section } from "./sheet";
import type { BoardCtx } from "./kanban-board";

/* ---------------------------------- mentions --------------------------------- */

/** Renders a stored comment with highlighted @mentions (yours stand out more). */
export function CommentBody({ body, meId }: { body: string; meId: string }) {
  return (
    <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground">
      {parseMentions(body).map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span
            key={i}
            className={cn(
              "rounded px-1 py-px font-medium",
              p.userId === meId.toLowerCase() ? "bg-amber-100 text-amber-900" : "bg-primary-soft text-primary"
            )}
          >
            @{p.name}
          </span>
        )
      )}
    </p>
  );
}

/** Comment input with an @mention picker (type @ then a name; ↑/↓, Enter or Tab to pick). */
export function CommentComposer({ ctx, onSend, pending }: { ctx: BoardCtx; onSend: (body: string) => Promise<boolean>; pending: boolean }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return ctx.members
      .filter((m) => m.id !== ctx.me.id && (q === "" || m.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || m.name.toLowerCase().startsWith(q)))
      .slice(0, 6);
  }, [query, ctx.members, ctx.me.id]);

  function refreshQuery(value: string, caret: number) {
    const q = activeMentionQuery(value.slice(0, caret));
    setQuery(q);
    setIndex(0);
  }

  function pick(m: { id: string; name: string }) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@[\]()]{0,30})$/, `@${m.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setPicked((p) => (p.some((x) => x.id === m.id) ? p : [...p, { id: m.id, name: m.name }]));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  async function submit() {
    const body = encodeMentions(text.trim(), picked);
    if (!body) return;
    if (await onSend(body)) {
      setText("");
      setPicked([]);
    }
  }

  return (
    <div className="relative mt-4">
      <div className="flex gap-2">
        <textarea
          ref={ref}
          value={text}
          rows={2}
          maxLength={4000}
          placeholder="Write a comment… type @ to mention someone"
          className="min-h-12 flex-1 resize-y rounded-lg border border-border-strong bg-white px-3 py-2.5 text-[15px] leading-relaxed outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
          onChange={(e) => {
            setText(e.target.value);
            refreshQuery(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => refreshQuery(e.currentTarget.value, e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (suggestions.length) {
              if (e.key === "ArrowDown") return void (e.preventDefault(), setIndex((i) => (i + 1) % suggestions.length));
              if (e.key === "ArrowUp") return void (e.preventDefault(), setIndex((i) => (i - 1 + suggestions.length) % suggestions.length));
              if (e.key === "Enter" || e.key === "Tab") return void (e.preventDefault(), pick(suggestions[index]!));
              if (e.key === "Escape") return void (e.preventDefault(), setQuery(null));
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          aria-label="Comment"
        />
        <Button variant="subtle" className="self-end" disabled={pending || !text.trim()} aria-label="Send comment" onClick={() => void submit()}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <p className="mt-1 text-[12.5px] text-subtle">Ctrl + Enter to send · mentioned people get a notification</p>
      {suggestions.length > 0 && (
        <div role="listbox" className="absolute bottom-full left-0 z-30 mb-1 w-72 overflow-hidden rounded-xl border border-border bg-white p-1 shadow-lift">
          {suggestions.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={i === index}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              onMouseEnter={() => setIndex(i)}
              className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[15px]", i === index && "bg-primary-soft")}
            >
              <Avatar id={m.id} name={m.name} src={m.avatarUrl} size={24} />
              <span className="flex-1 truncate">{m.name}</span>
              <span className="text-[12.5px] capitalize text-subtle">{m.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- time tracking ------------------------------- */

type Entry = { id: string; userId: string; userName: string; startedAt: string; endedAt: string | null; minutes: number | null; note: string | null; manual: boolean };
type Running = { id: string; taskId: string; startedAt: string; ref: string; title: string; projectKey: string } | null;

export function TimeSection({ ctx, task }: { ctx: BoardCtx; task: TaskDTO }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [running, setRunning] = useState<Running>(null);
  const [now, setNow] = useState(() => Date.now());
  const [logging, setLogging] = useState(false);
  const [duration, setDuration] = useState("");
  const [date, setDate] = useState(() => todayISO());
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const canTrack = can(ctx.role, "CREATE_OR_MOVE_TASK");
  const isAdmin = hasRole(ctx.role, "admin");

  const load = useCallback(() => {
    taskTimeAction(ctx.org.id, task.id).then((r) => {
      if (!r.ok) return;
      setEntries(r.entries);
      setRunning(r.running);
    });
  }, [ctx.org.id, task.id]);
  useEffect(load, [load]);
  useSignal((e) => {
    if ((e.type === "TIME_CHANGED" && e.taskId === task.id) || e.type === "LOCAL_TIMER") load();
  });

  const anyRunning = entries.some((e) => !e.endedAt);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  const total = entries.reduce((s, e) => s + (e.endedAt ? (e.minutes ?? 0) : Math.min(1440, (now - new Date(e.startedAt).getTime()) / 60_000)), 0);
  const estimate = (task.estimateHours ?? 0) * 60;
  const pct = estimate ? Math.min(100, (total / estimate) * 100) : 0;
  const over = estimate > 0 && total > estimate;
  const mineHere = running?.taskId === task.id;

  const toggle = () =>
    start(async () => {
      const r = mineHere ? await stopTimerAction(ctx.org.id) : await startTimerAction(ctx.org.id, task.id);
      if (!r.ok) return void toast.error(r.message);
      if ("minutes" in r) toast.success(r.discarded ? "Timer discarded (under a minute)" : `Logged ${formatMinutes(r.minutes)} on ${ctx.project.key}-${task.taskNumber}`);
      emitSignal({ type: "LOCAL_TIMER" });
    });

  const submitLog = () => {
    const minutes = parseDuration(duration);
    if (!minutes) return void toast.error("Enter a duration like 1h 30m, 45m or 1:15");
    start(async () => {
      const r = await addTimeEntryAction(ctx.org.id, { taskId: task.id, minutes, date, note: note.trim() || null });
      if (!r.ok) return void toast.error(r.message);
      setDuration("");
      setNote("");
      setLogging(false);
      emitSignal({ type: "LOCAL_TIMER" });
    });
  };

  return (
    <Section
      title="Time tracked"
      icon={<Timer className="h-4 w-4 text-subtle" />}
      action={
        canTrack && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setLogging((l) => !l)}>
              <Plus className="h-3.5 w-3.5" /> Log time
            </Button>
            <Button size="sm" variant={mineHere ? "destructive" : "ai"} disabled={pending} onClick={toggle}>
              {mineHere ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
              {mineHere ? `Stop ${elapsedClock(running!.startedAt, now)}` : "Start timer"}
            </Button>
          </div>
        )
      }
    >
      <div className="rounded-xl border border-border bg-elevated p-3.5">
        <div className="flex items-baseline justify-between text-[15px]">
          <span>
            <b className="text-[18px] font-semibold tabular-nums">{formatMinutes(total)}</b>
            {estimate > 0 && <span className="text-muted"> of {formatMinutes(estimate)} estimated</span>}
          </span>
          {over && <span className="text-[13px] font-medium text-rose-600">{formatMinutes(total - estimate)} over estimate</span>}
        </div>
        {estimate > 0 && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Time tracked against estimate">
            <div className={cn("h-full rounded-full transition-all", over ? "bg-rose-500" : "bg-primary")} style={{ width: `${pct}%` }} />
          </div>
        )}
        {running && !mineHere && canTrack && (
          <p className="mt-2 text-[13px] text-muted">
            Your timer is running on <b className="font-medium">{running.ref}</b>. Starting here will stop it.
          </p>
        )}
      </div>

      {logging && (
        <form
          className="mt-3 grid animate-fade-up grid-cols-[1fr_auto] gap-2 rounded-xl border border-border p-3 sm:grid-cols-[8rem_10rem_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            submitLog();
          }}
        >
          <Input autoFocus value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="1h 30m" aria-label="Duration" className="h-10" />
          <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} aria-label="Date" className="h-10" />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on? (optional)" maxLength={200} aria-label="Note" className="h-10 sm:col-span-1 col-span-2" />
          <Button size="sm" className="h-10" disabled={pending}>Save</Button>
        </form>
      )}

      {entries.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {entries.slice(0, 8).map((e) => (
            <li key={e.id} className="group flex items-center gap-2.5 py-2 text-[14.5px]">
              <Avatar id={e.userId} name={e.userName} size={22} />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-medium">{e.userName}</b>
                <span className="text-muted"> · {e.endedAt ? formatMinutes(e.minutes ?? 0) : <span className="font-medium text-primary">running {elapsedClock(e.startedAt, now)}</span>}</span>
                {e.note && <span className="text-muted"> · {e.note}</span>}
              </span>
              <span className="shrink-0 text-[12.5px] text-subtle">{e.manual ? new Date(e.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : timeAgo(e.startedAt)}</span>
              {e.endedAt && (e.userId === ctx.me.id || isAdmin) && (
                <button
                  aria-label="Delete time entry"
                  className="cursor-pointer rounded p-1 text-subtle opacity-0 transition hover:bg-hover hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"
                  onClick={() =>
                    start(async () => {
                      const r = await deleteTimeEntryAction(ctx.org.id, task.id, e.id);
                      if (!r.ok) return void toast.error(r.message);
                      load();
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* --------------------------------- attachments -------------------------------- */

type Attachment = { id: string; filename: string; contentType: string; size: number; createdAt: string; uploadedById: string | null; uploadedByName: string | null };

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const IMAGE = /^image\/(png|jpeg|gif|webp)$/;

export function AttachmentsSection({ ctx, task }: { ctx: BoardCtx; task: TaskDTO }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const canUpload = can(ctx.role, "CREATE_OR_MOVE_TASK");
  const isAdmin = hasRole(ctx.role, "admin");

  const load = useCallback(() => {
    listAttachmentsAction(ctx.org.id, task.id).then((r) => r.ok && setItems(r.attachments));
  }, [ctx.org.id, task.id]);
  useEffect(load, [load]);
  useSignal((e) => e.type === "ATTACHMENTS_CHANGED" && e.taskId === task.id && load());

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files).slice(0, 10)) {
      if (file.size > 4 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 4 MB`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.set("organizationId", ctx.org.id);
        form.set("taskId", task.id);
        form.set("file", file);
        const res = await fetch("/api/attachments", { method: "POST", body: form });
        const json = (await res.json().catch(() => ({ ok: false, message: "Upload failed" }))) as { ok: boolean; message?: string };
        if (!json.ok) toast.error(json.message ?? "Upload failed");
      } catch {
        toast.error(`Couldn't upload ${file.name}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    load();
  }

  return (
    <Section
      title={`Attachments · ${items.length}`}
      icon={<Paperclip className="h-4 w-4 text-subtle" />}
      action={
        canUpload && (
          <Button size="sm" variant="ghost" disabled={uploading > 0} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
          </Button>
        )
      }
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = "";
        }}
      />
      <div
        onDragOver={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (canUpload && e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
        className={cn("rounded-xl transition", drag && "bg-primary-soft ring-2 ring-primary/40")}
      >
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong px-4 py-5 text-center text-[14.5px] text-subtle">
            {canUpload ? "Drop files here or use Upload · up to 4 MB each" : "No files attached"}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {items.map((a) => {
              const isImage = IMAGE.test(a.contentType);
              const url = `/api/attachments/${a.id}`;
              return (
                <div key={a.id} className="group flex items-center gap-3 rounded-xl border border-border bg-white p-2 pr-2.5">
                  {isImage ? (
                    <button onClick={() => setPreview(a)} className="h-11 w-11 shrink-0 cursor-zoom-in overflow-hidden rounded-lg bg-surface-2" aria-label={`Preview ${a.filename}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </button>
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                      <FileText className="h-5 w-5" />
                    </span>
                  )}
                  <a href={`${url}?download=1`} className="min-w-0 flex-1 hover:underline" title={`Download ${a.filename}`}>
                    <span className="block truncate text-[14.5px] font-medium">{a.filename}</span>
                    <span className="block truncate text-[12.5px] text-subtle">
                      {formatBytes(a.size)} · {a.uploadedByName ?? "Someone"} · {timeAgo(a.createdAt)}
                    </span>
                  </a>
                  {(a.uploadedById === ctx.me.id || isAdmin) && (
                    <button
                      aria-label={`Delete ${a.filename}`}
                      className="cursor-pointer rounded p-1 text-subtle opacity-0 transition hover:bg-hover hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"
                      onClick={async () => {
                        if (!confirm(`Delete ${a.filename}? This can't be undone.`)) return;
                        const r = await deleteAttachmentAction(ctx.org.id, a.id);
                        if (!r.ok) return void toast.error(r.message);
                        load();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {preview && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-6" onClick={() => setPreview(null)} role="dialog" aria-label={preview.filename}>
          <button className="absolute right-4 top-4 cursor-pointer rounded-full bg-white/90 p-2" aria-label="Close preview">
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/attachments/${preview.id}`} alt={preview.filename} className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>
      )}
    </Section>
  );
}

/* ---------------------------------- linked docs -------------------------------- */

export function LinkedDocs({ ctx, task }: { ctx: BoardCtx; task: TaskDTO }) {
  const [docs, setDocs] = useState<{ id: string; title: string }[]>([]);
  const load = useCallback(() => {
    docsForTaskAction(ctx.org.id, task.id).then((r) => r.ok && setDocs(r.docs));
  }, [ctx.org.id, task.id]);
  useEffect(load, [load]);
  useSignal((e) => e.type === "DOCS_CHANGED" && load());
  if (!docs.length) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-[14px]">
      <span className="text-subtle">Docs:</span>
      {docs.map((d) => (
        <Link key={d.id} href={`/w/${ctx.org.slug}/docs/${d.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1 font-medium hover:border-primary/40 hover:text-primary">
          <FileText className="h-3.5 w-3.5" /> {d.title}
        </Link>
      ))}
    </div>
  );
}


/* ------------------------------------ repeat ------------------------------------ */

const FREQ_LABEL = { daily: "day", weekdays: "weekday", weekly: "week", monthly: "month" } as const;
type Freq = keyof typeof FREQ_LABEL;

/** "Repeat every 2 weeks": when the task is done, the next one is created automatically. */
export function RepeatField({ ctx, task, rule, onChanged }: { ctx: BoardCtx; task: TaskDTO; rule: { frequency: Freq; interval: number } | undefined; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const canEdit = can(ctx.role, "CREATE_OR_MOVE_TASK");
  const save = (next: { frequency: Freq; interval: number } | null) =>
    start(async () => {
      const r = await setRecurrenceAction(ctx.org.id, task.id, next);
      if (!r.ok) return void toast.error(r.message);
      onChanged();
    });
  if (!canEdit) {
    return <span className="text-[15px]">{rule ? `Every ${rule.interval > 1 ? `${rule.interval} ` : ""}${FREQ_LABEL[rule.frequency]}${rule.interval > 1 ? "s" : ""}` : <span className="text-subtle">Doesn't repeat</span>}</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Repeat"
        disabled={pending}
        value={rule?.frequency ?? ""}
        onChange={(e) => save(e.target.value ? { frequency: e.target.value as Freq, interval: rule?.interval ?? 1 } : null)}
        className="h-8 cursor-pointer rounded-md border border-border bg-white px-2 text-[14px] outline-none hover:border-border-strong focus:border-primary"
      >
        <option value="">Doesn't repeat</option>
        <option value="daily">Daily</option>
        <option value="weekdays">Every weekday</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
      {rule && (
        <>
          <span className="text-[14px] text-muted">every</span>
          <select
            aria-label="Repeat interval"
            disabled={pending}
            value={rule.interval}
            onChange={(e) => save({ frequency: rule.frequency, interval: Number(e.target.value) })}
            className="h-8 cursor-pointer rounded-md border border-border bg-white px-2 text-[14px] outline-none hover:border-border-strong focus:border-primary"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n} {FREQ_LABEL[rule.frequency]}{n > 1 ? "s" : ""}</option>
            ))}
          </select>
          <span className="text-[13px] text-subtle">· next one is created when this is done</span>
        </>
      )}
    </div>
  );
}
