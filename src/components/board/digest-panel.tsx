"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { sprintDigestAction } from "@/actions/ai.actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Sheet } from "./sheet";
import { aiSourceLabel } from "@/lib/ai-label";
import type { BoardCtx } from "./kanban-board";

type Digest = {
  headline: string;
  completed: string[];
  inProgress: string[];
  blockersAndRisks: string[];
  suggestedFocus: string[];
};

export function DigestPanel({ ctx, onClose }: { ctx: BoardCtx; onClose: () => void }) {
  const [hours, setHours] = useState(72);
  const [result, setResult] = useState<{ digest: Digest; provider: string; note?: string; stats: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = (h: number) =>
    start(async () => {
      setError(null);
      const r = await sprintDigestAction(ctx.org.id, ctx.project.id, h);
      if (!r.ok) return setError(r.message);
      setResult({ digest: r.digest, provider: r.provider, note: r.fallbackReason, stats: r.stats });
    });

  useEffect(() => load(hours), []); // eslint-disable-line react-hooks/exhaustive-deps

  const Section = ({ title, items }: { title: string; items: string[] }) =>
    items.length === 0 ? null : (
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((i, k) => <li key={k}>{i}</li>)}</ul>
      </div>
    );

  return (
    <Sheet title={`Standup digest · ${ctx.project.name}`} onClose={onClose}>
      <div className="mb-4 flex items-center gap-2">
        <Select value={hours} onChange={(e) => { const h = Number(e.target.value); setHours(h); load(h); }} className="w-40">
          <option value={24}>Last 24 hours</option>
          <option value={72}>Last 3 days</option>
          <option value={168}>Last 7 days</option>
          <option value={336}>Last 14 days</option>
        </Select>
        <Button variant="outline" size="sm" onClick={() => load(hours)} disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Regenerate
        </Button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!result && pending && <p className="text-sm text-muted">Summarizing recent work…</p>}
      {result && (
        <div className="space-y-4">
          <p className="text-base font-medium">{result.digest.headline}</p>
          <div className="grid grid-cols-4 gap-2 text-center">
            {Object.entries({ Done: result.stats.done, "In flight": result.stats.inFlight, "High pri": result.stats.highPriority, Events: result.stats.events }).map(([k, v]) => (
              <div key={k} className="rounded-md bg-foreground/5 p-2">
                <div className="text-lg font-semibold">{v}</div>
                <div className="text-[13px] text-muted">{k}</div>
              </div>
            ))}
          </div>
          <Section title="Completed" items={result.digest.completed} />
          <Section title="In progress" items={result.digest.inProgress} />
          <Section title="Blockers & risks" items={result.digest.blockersAndRisks} />
          <Section title="Suggested focus" items={result.digest.suggestedFocus} />
          <p className="text-[13px] text-muted">
            {aiSourceLabel(result.provider, result.note)} · Based on this project&apos;s tasks and recent activity.
          </p>
        </div>
      )}
    </Sheet>
  );
}
