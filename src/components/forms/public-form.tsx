"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { submitFormAction } from "@/actions/board-power.actions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type Field = { key: string; label: string; required: boolean; help?: string | null; type: string; options?: { value: string; label: string }[] };

export function PublicForm({ token, form }: { token: string; form: { name: string; description: string | null; workspace: string; fields: Field[] } }) {
  const [sent, setSent] = useState<{ ref: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (sent) {
    return (
      <Card className="p-10 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Thanks, we got it</h1>
        <p className="mt-2 text-[15px] text-muted">{form.workspace} will take it from here{sent.ref ? `. Your reference is ${sent.ref}.` : "."}</p>
        <button className="mt-6 cursor-pointer text-[14px] font-medium text-primary hover:underline" onClick={() => setSent(null)}>Send another response</button>
      </Card>
    );
  }

  return (
    <Card className="p-8">
      <p className="text-[13px] font-medium text-subtle">{form.workspace}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{form.name}</h1>
      {form.description && <p className="mt-2 whitespace-pre-wrap text-[15px] text-muted">{form.description}</p>}
      <form
        className="mt-6 space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const values: Record<string, string> = {};
          for (const f of form.fields) values[f.key] = String(fd.get(f.key) ?? "");
          setPending(true);
          setError(null);
          const r = await submitFormAction(token, values, String(fd.get("website") ?? ""));
          setPending(false);
          if (!r.ok) return setError(r.message);
          setSent({ ref: r.ref });
        }}
      >
        {form.fields.map((f) => {
          const id = `q-${f.key.replace(/[^a-z0-9]/gi, "")}`;
          const label = <Label htmlFor={id}>{f.label}{f.required && <span className="text-rose-600"> *</span>}</Label>;
          const help = f.help ? <p className="text-[13px] text-subtle">{f.help}</p> : null;
          if (f.type === "textarea" || f.type === "text" && f.key === "description") {
            return <div key={f.key} className="space-y-1.5">{label}<textarea id={id} name={f.key} required={f.required} rows={5} maxLength={8000} className="w-full rounded-lg border border-border bg-white px-3 py-2 text-[15px] outline-none focus:border-primary" />{help}</div>;
          }
          if (f.options) {
            return (
              <div key={f.key} className="space-y-1.5">{label}
                <select id={id} name={f.key} required={f.required} defaultValue="" className="h-11 w-full rounded-lg border border-border bg-white px-3 text-[15px]">
                  <option value="" disabled={f.required}>Choose…</option>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>{help}
              </div>
            );
          }
          const type = f.type === "email" ? "email" : f.type === "date" ? "date" : f.type === "number" ? "number" : "text";
          return <div key={f.key} className="space-y-1.5">{label}<Input id={id} name={f.key} type={type} required={f.required} maxLength={f.key === "title" ? 200 : 300} autoComplete={f.key === "email" ? "email" : f.key === "name" ? "name" : "off"} />{help}</div>;
        })}
        {/* Honeypot: hidden from people, irresistible to bots. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-[14px] text-rose-800">{error}</p>}
        <Button size="lg" className="w-full" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Submit</Button>
      </form>
    </Card>
  );
}
