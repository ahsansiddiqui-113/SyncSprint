"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Rocket, X } from "lucide-react";
import type { OnboardingStep } from "@/server/services/onboarding";
import { dismissOnboardingAction } from "@/actions/growth.actions";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function OnboardingChecklist({ organizationId, steps, done, total, canDismiss }: { organizationId: string; steps: OnboardingStep[]; done: number; total: number; canDismiss: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = steps.find((s) => !s.done);
  return (
    <Card className="mb-8 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-linear-to-r from-primary-soft to-white px-6 py-4">
        <Rocket className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold tracking-tight">Get set up</h2>
          <p className="text-[13.5px] text-muted">{done} of {total} done{next ? ` · next: ${next.title.toLowerCase()}` : " · all done!"}</p>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / total) * 100}%` }} />
        </div>
        {canDismiss && (
          <button
            aria-label="Hide the checklist"
            title="Hide for everyone"
            disabled={pending}
            onClick={() => start(async () => {
              const r = await dismissOnboardingAction(organizationId);
              if (!r.ok) return void toast.error(r.message);
              router.refresh();
            })}
            className="cursor-pointer rounded-md p-1.5 text-subtle hover:bg-hover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <ol className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s) => (
          <li key={s.id} className="bg-white">
            <Link href={s.href} className={cn("flex h-full gap-3 px-5 py-4 transition-colors hover:bg-[#fafafe]", s.done && "opacity-70")}>
              {s.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-border-strong" />}
              <span>
                <span className={cn("block text-[14.5px] font-semibold", s.done && "line-through")}>{s.title}</span>
                <span className="mt-0.5 block text-[13px] text-muted">{s.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
