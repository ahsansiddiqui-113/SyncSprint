import { Suspense } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { AuthForm } from "./auth-form";
import { DemoButton } from "./demo-button";
import { Logo } from "@/components/ui/card";
import { isGoogleEnabled } from "@/lib/auth";

const POINTS = [
  "Isolated workspaces with owner, admin, member and viewer roles",
  "Live presence and conflict-safe drag-and-drop",
  "AI subtasks, triage and standup digests",
];

export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-linear-to-br from-[#7b68ee] via-[#8e5cf0] to-[#e44a8a] p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-[420px] w-[420px] rounded-full bg-[#49ccf9]/30 blur-3xl" />
        <Link href="/" className="relative">
          <Logo className="text-white" />
        </Link>
        <div className="relative max-w-lg">
          <h2 className="text-5xl font-extrabold leading-[1.08] tracking-tight">Ship sprints together, in real time.</h2>
          <ul className="mt-8 space-y-4 text-[17px] text-white/90">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20"><Check className="h-3.5 w-3.5" /></span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[14px] text-white/70">Passwords are hashed by Better Auth; sessions are httpOnly cookies.</p>
      </div>

      <div className="flex flex-col items-center justify-center gap-8 bg-canvas px-6 py-12">
        <Link href="/" className="lg:hidden"><Logo /></Link>
        <Suspense>
          <AuthForm mode={mode} googleEnabled={isGoogleEnabled} />
        </Suspense>
        <div className="flex w-full max-w-md items-center gap-3 text-[14px] text-subtle">
          <span className="h-px flex-1 bg-border-strong" /> or just explore <span className="h-px flex-1 bg-border-strong" />
        </div>
        <DemoButton size="md" />
      </div>
    </main>
  );
}
