"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Trash2 } from "lucide-react";
import { createProjectAction } from "@/actions/workspace.actions";
import { deleteProjectTemplateAction, listProjectTemplatesAction } from "@/actions/growth.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Suggest a project code from its name: "Website Redesign" → "WR", "Marketing" → "MAR".
 * Codes are 2-10 letters/digits starting with a letter.
 */
export function suggestKey(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const key = words.length > 1 ? words.map((w) => w[0]).join("") : words[0]!.slice(0, 3);
  return (/^[A-Z]/.test(key) ? key : `P${key}`).slice(0, 10);
}

type Template = { id: string; name: string; description: string; icon: string; builtin: boolean; statuses: string[]; fields: number; tasks: number };

export function CreateProjectForm({ organizationId, orgSlug }: { organizationId: string; orgSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const shownKey = touched ? key : suggestKey(name);

  const load = () => void listProjectTemplatesAction(organizationId).then((r) => r.ok && setTemplates(r.templates));
  useEffect(load, [organizationId]);
  const chosen = templates.find((t) => t.id === templateId);

  return (
    <form
      className="space-y-4"
      action={(fd) =>
        start(async () => {
          const res = await createProjectAction({
            organizationId,
            name: String(fd.get("name")),
            key: shownKey,
            description: String(fd.get("description") || "") || undefined,
            templateId,
          });
          if (!res.ok) return void toast.error(res.message);
          router.push(`/w/${orgSlug}/projects/${res.key}`);
        })
      }
    >
      <fieldset>
        <legend className="mb-2 text-[14px] font-medium">Start from</legend>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          <TemplateCard selected={templateId === null} onClick={() => setTemplateId(null)} icon="📄" name="Blank board" description="Backlog, In Progress, Review and Done." />
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              selected={templateId === t.id}
              onClick={() => setTemplateId(t.id)}
              icon={t.icon}
              name={t.name}
              description={t.description || `${t.statuses.length} statuses · ${t.fields} fields · ${t.tasks} tasks`}
              tag={t.builtin ? undefined : "Yours"}
              onDelete={t.builtin ? undefined : async () => {
                if (!window.confirm(`Delete the template "${t.name}"? Projects made from it stay.`)) return;
                const r = await deleteProjectTemplateAction(organizationId, t.id);
                if (!r.ok) return void toast.error(r.message);
                if (templateId === t.id) setTemplateId(null);
                load();
              }}
            />
          ))}
        </div>
        {chosen && (
          <p className="mt-2 text-[13px] text-subtle">
            Statuses: {chosen.statuses.join(" → ")}{chosen.fields ? ` · ${chosen.fields} custom fields` : ""}{chosen.tasks ? ` · ${chosen.tasks} starter tasks` : ""}
          </p>
        )}
      </fieldset>
      <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
        <Input name="name" placeholder="Project name, e.g. Website Redesign" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} aria-label="Project name" />
        <Input
          name="key"
          placeholder="Code, e.g. WEB"
          title="A short code for the project. Tasks are numbered with it, like WEB-1, WEB-2."
          aria-label="Project code"
          aria-describedby="project-key-help"
          required
          pattern="[A-Za-z][A-Za-z0-9]{1,9}"
          maxLength={10}
          className="uppercase"
          value={shownKey}
          onChange={(e) => {
            setTouched(true);
            setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
          }}
        />
        <Button disabled={pending}>{pending ? "Creating…" : "Create"}</Button>
        <p id="project-key-help" className="text-[13px] text-subtle sm:col-span-3">
          The <b className="font-medium text-muted">code</b> is the short prefix for this project&apos;s task numbers
          {shownKey ? <> — tasks will be <b className="font-mono font-medium text-muted">{shownKey}-1</b>, <b className="font-mono font-medium text-muted">{shownKey}-2</b> and so on</> : <>, like ENG-1 or MKT-12</>}. Use 2-10 letters or digits; it can&apos;t be changed later.
        </p>
        <Input name="description" placeholder="Description (optional)" className="sm:col-span-3" />
      </div>
    </form>
  );
}

function TemplateCard({ selected, onClick, icon, name, description, tag, onDelete }: { selected: boolean; onClick: () => void; icon: string; name: string; description: string; tag?: string; onDelete?: () => void }) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      className={cn(
        "relative flex cursor-pointer gap-3 rounded-xl border p-3 text-left transition-colors",
        selected ? "border-primary bg-primary-soft/60 ring-1 ring-primary" : "border-border bg-white hover:border-border-strong"
      )}
    >
      <span className="text-2xl leading-none" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14.5px] font-semibold">
          {name} {tag && <span className="rounded bg-surface-2 px-1.5 text-[11px] font-semibold text-muted">{tag}</span>}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{description}</span>
      </span>
      {selected && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />}
      {onDelete && (
        <button type="button" aria-label={`Delete template ${name}`} onClick={(e) => (e.stopPropagation(), onDelete())} className="absolute bottom-2 right-2 cursor-pointer rounded p-1 text-subtle hover:bg-hover hover:text-rose-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
