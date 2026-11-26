"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createProjectAction } from "@/actions/workspace.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

export function CreateProjectForm({ organizationId, orgSlug }: { organizationId: string; orgSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const shownKey = touched ? key : suggestKey(name);

  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_150px_auto]"
      action={(fd) =>
        start(async () => {
          const res = await createProjectAction({
            organizationId,
            name: String(fd.get("name")),
            key: shownKey,
            description: String(fd.get("description") || "") || undefined,
          });
          if (!res.ok) return void toast.error(res.message);
          router.push(`/w/${orgSlug}/projects/${res.key}`);
        })
      }
    >
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
    </form>
  );
}
