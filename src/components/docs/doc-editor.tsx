"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { AlertTriangle, Bold, Check, ChevronRight, Code, Eye, Heading2, List, ListChecks, Loader2, Pencil, Quote, Trash2, X } from "lucide-react";
import { deleteDocAction, saveDocAction, setDocTaskLinkAction } from "@/actions/collab.actions";
import { Button } from "@/components/ui/button";
import { useSignal } from "@/components/workspace/signals";
import { cn, timeAgo } from "@/lib/utils";
import { TaskPicker } from "./task-picker";

type DocData = {
  id: string;
  title: string;
  content: string;
  version: number;
  updatedAt: string;
  updatedByName: string | null;
  tasks: { id: string; title: string; ref: string; projectKey: string }[];
};

type Conflict = { title: string; content: string; version: number; updatedByName: string | null };

/** Safe markdown: GFM (tables, task lists), no raw HTML, links open in a new tab. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="doc-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer nofollow" />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

const TOOLS = [
  { icon: Heading2, label: "Heading", before: "## ", after: "", line: true },
  { icon: Bold, label: "Bold", before: "**", after: "**", line: false },
  { icon: List, label: "Bulleted list", before: "- ", after: "", line: true },
  { icon: ListChecks, label: "Checklist", before: "- [ ] ", after: "", line: true },
  { icon: Quote, label: "Quote", before: "> ", after: "", line: true },
  { icon: Code, label: "Code", before: "`", after: "`", line: false },
] as const;

export function DocEditor({
  org,
  doc,
  canEdit,
  canDelete,
  startEditing,
}: {
  org: { id: string; slug: string; name: string };
  doc: DocData;
  canEdit: boolean;
  canDelete: boolean;
  startEditing: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(startEditing);
  const [title, setTitle] = useState(doc.title);
  const [content, setContent] = useState(doc.content);
  const [version, setVersion] = useState(doc.version);
  const [saved, setSaved] = useState({ title: doc.title, content: doc.content, at: doc.updatedAt, by: doc.updatedByName });
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [remoteNewer, setRemoteNewer] = useState(false);
  const [tasks, setTasks] = useState(doc.tasks);
  const [pending, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const saving = useRef(false);

  const dirty = title !== saved.title || content !== saved.content;

  // Fresh server data (after router.refresh) replaces local state when we have no edits.
  useEffect(() => {
    setTasks(doc.tasks);
    if (dirty || doc.version <= version) return;
    setTitle(doc.title);
    setContent(doc.content);
    setVersion(doc.version);
    setSaved({ title: doc.title, content: doc.content, at: doc.updatedAt, by: doc.updatedByName });
    setRemoteNewer(false);
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  useSignal((e) => {
    if (e.type !== "DOCS_CHANGED" || e.docId !== doc.id) return;
    if (e.version === null) return void router.refresh(); // links changed or deleted
    if (e.version > version) {
      if (dirty) setRemoteNewer(true);
      else router.refresh();
    }
  });

  const save = useCallback(
    async (opts: { overwriteVersion?: number } = {}) => {
      if (saving.current || !title.trim()) return;
      saving.current = true;
      setStatus("saving");
      const expectedVersion = opts.overwriteVersion ?? version;
      const r = await saveDocAction(org.id, { docId: doc.id, expectedVersion, title: title.trim(), content });
      saving.current = false;
      if (!r.ok) {
        setStatus("error");
        return void toast.error(r.message);
      }
      if (r.conflict) {
        setStatus("idle");
        setConflict(r.current);
        return;
      }
      setVersion(r.version);
      setSaved({ title: title.trim(), content, at: r.updatedAt, by: "you" });
      setConflict(null);
      setRemoteNewer(false);
      setStatus("idle");
    },
    [org.id, doc.id, version, title, content]
  );

  // Autosave 1.2s after typing stops (never while resolving a conflict).
  useEffect(() => {
    if (!editing || !dirty || conflict || !title.trim()) return;
    const id = setTimeout(() => void save(), 1200);
    return () => clearTimeout(id);
  }, [editing, dirty, conflict, title, content, save]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);

  function applyTool(t: (typeof TOOLS)[number]) {
    const el = area.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    let next: string;
    let caret: number;
    if (t.line) {
      const lineStart = content.lastIndexOf("\n", s - 1) + 1;
      next = content.slice(0, lineStart) + t.before + content.slice(lineStart);
      caret = e + t.before.length;
    } else {
      next = content.slice(0, s) + t.before + content.slice(s, e) + t.after + content.slice(e);
      caret = e + t.before.length;
    }
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  const statusText =
    status === "saving" ? "Saving…" : status === "error" ? "Couldn't save" : dirty ? "Unsaved changes" : `Saved · edited ${timeAgo(saved.at)}${saved.by ? ` by ${saved.by}` : ""}`;

  return (
    <main className="w-full px-10 py-8 2xl:px-14">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <nav className="flex min-w-0 items-center gap-1.5 text-[14.5px] text-subtle" aria-label="Breadcrumb">
          <Link href={`/w/${org.slug}/docs`} className="hover:text-foreground">Docs</Link>
          <ChevronRight className="h-4 w-4" />
          <span className="truncate text-foreground">{title || "Untitled"}</span>
        </nav>
        <span className={cn("text-[13.5px]", status === "error" ? "text-rose-600" : dirty ? "text-amber-700" : "text-subtle")} aria-live="polite">
          {status === "saving" && <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
          {statusText}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {canEdit &&
            (editing ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  if (dirty) await save();
                  setEditing(false);
                }}
              >
                <Check className="h-4 w-4" /> Done
              </Button>
            ) : (
              <Button size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
            ))}
          {canDelete && (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Delete doc"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Delete “${saved.title}”? This can't be undone.`)) return;
                start(async () => {
                  const r = await deleteDocAction(org.id, doc.id);
                  if (!r.ok) return void toast.error(r.message);
                  toast.success("Doc deleted");
                  router.push(`/w/${org.slug}/docs`);
                });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {conflict && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[15px] text-amber-900" role="alert">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <b>{conflict.updatedByName ?? "Someone"}</b> saved a newer version while you were editing. Your changes are still here and nothing was overwritten.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTitle(conflict.title);
              setContent(conflict.content);
              setVersion(conflict.version);
              setSaved({ title: conflict.title, content: conflict.content, at: new Date().toISOString(), by: conflict.updatedByName });
              setConflict(null);
            }}
          >
            Load their version
          </Button>
          <Button size="sm" onClick={() => void save({ overwriteVersion: conflict.version })}>
            Keep mine
          </Button>
        </div>
      )}
      {remoteNewer && !conflict && (
        <p className="mb-4 rounded-lg bg-sky-50 px-3 py-2 text-[14px] text-sky-900">Someone just saved this doc. Saving yours will ask how to combine them.</p>
      )}

      {editing ? (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
          placeholder="Untitled"
          aria-label="Title"
          className="w-full bg-transparent text-4xl font-bold tracking-tight outline-none placeholder:text-subtle"
        />
      ) : (
        <h1 className="text-4xl font-bold tracking-tight">{title || "Untitled"}</h1>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {tasks.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white py-1 pl-2.5 pr-1 text-[14px]">
            <Link href={`/w/${org.slug}/projects/${t.projectKey}?task=${t.id}`} className="flex items-center gap-1.5 hover:text-primary">
              <span className="font-mono text-[12.5px] text-subtle">{t.ref}</span>
              <span className="max-w-56 truncate font-medium">{t.title}</span>
            </Link>
            {canEdit && (
              <button
                aria-label={`Unlink ${t.ref}`}
                className="cursor-pointer rounded p-0.5 text-subtle hover:bg-hover hover:text-foreground"
                onClick={async () => {
                  const r = await setDocTaskLinkAction(org.id, doc.id, t.id, false);
                  if (!r.ok) return void toast.error(r.message);
                  setTasks((xs) => xs.filter((x) => x.id !== t.id));
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </span>
        ))}
        {canEdit && (
          <TaskPicker
            organizationId={org.id}
            exclude={tasks.map((t) => t.id)}
            onPick={async (t) => {
              const r = await setDocTaskLinkAction(org.id, doc.id, t.id, true);
              if (!r.ok) return void toast.error(r.message);
              setTasks((xs) => [...xs, { ...t, projectKey: t.ref.split("-")[0]! }]);
            }}
          />
        )}
      </div>

      <div className="mt-6 border-t border-border pt-6">
        {editing ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-1">
                {TOOLS.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    title={t.label}
                    aria-label={t.label}
                    onClick={() => applyTool(t)}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground"
                  >
                    <t.icon className="h-4 w-4" />
                  </button>
                ))}
                <span className="ml-auto text-[12.5px] text-subtle">Markdown · Ctrl + S saves</span>
              </div>
              <textarea
                ref={area}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void save();
                  }
                }}
                maxLength={100_000}
                spellCheck
                aria-label="Doc content (markdown)"
                placeholder={"# Overview\n\nWrite in markdown: headings, lists, - [ ] checklists, tables, `code`…"}
                className="min-h-[60vh] w-full resize-y rounded-xl border border-border-strong bg-white p-4 font-mono text-[14.5px] leading-relaxed outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
              />
            </div>
            <div className="hidden lg:block">
              <div className="mb-2 flex h-8 items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wider text-subtle">
                <Eye className="h-4 w-4" /> Preview
              </div>
              <div className="min-h-[60vh] rounded-xl border border-border bg-elevated p-6">
                {content.trim() ? <Markdown source={content} /> : <p className="text-subtle">Nothing to preview yet.</p>}
              </div>
            </div>
          </div>
        ) : content.trim() ? (
          <div className="max-w-4xl">
            <Markdown source={content} />
          </div>
        ) : (
          <p className="text-[16px] text-subtle">{canEdit ? "This page is empty. Click Edit to start writing." : "This page is empty."}</p>
        )}
      </div>
    </main>
  );
}
