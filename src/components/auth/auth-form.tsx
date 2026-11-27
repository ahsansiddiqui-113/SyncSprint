"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export type AuthProviders = { google: boolean; microsoft: boolean; sso: boolean };

export function AuthForm({ mode, providers }: { mode: "sign-in" | "sign-up"; providers: AuthProviders }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/w";
  // Only allow same-origin relative redirects (no open redirect via ?next=//evil.com).
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/w";
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<"credentials" | "two-factor" | "sso">("credentials");

  const done = () => {
    router.push(safeNext);
    router.refresh();
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    if (mode === "sign-up") {
      const { error } = await authClient.signUp.email({ email, password, name: String(f.get("name")) });
      setPending(false);
      if (error) return void toast.error(error.message ?? "Couldn't create the account");
      return done();
    }
    const { data, error } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) return void toast.error(error.message ?? "Authentication failed");
    // Two-step sign-in is on for this account: ask for the code before any session exists.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setStep("two-factor");
    done();
  }

  const social = (provider: "google" | "microsoft") => authClient.signIn.social({ provider, callbackURL: safeNext });

  if (step === "two-factor") return <TwoFactorStep onDone={done} onBack={() => setStep("credentials")} />;
  if (step === "sso") return <SsoStep callbackURL={safeNext} onBack={() => setStep("credentials")} />;

  const other = mode === "sign-in" ? "sign-up" : "sign-in";
  return (
    <Card className="w-full max-w-md border-border p-8 shadow-lift">
      <h1 className="text-2xl font-semibold tracking-tight">{mode === "sign-in" ? "Welcome back" : "Create your account"}</h1>
      <p className="mt-1 text-sm text-muted">{mode === "sign-in" ? "Sign in to your workspaces." : "Start a workspace and invite your team."}</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {mode === "sign-up" && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={120} autoComplete="name" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required minLength={8} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} />
        </div>
        <Button className="mt-2 w-full" size="lg" disabled={pending}>
          {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Sign up"}
        </Button>
      </form>
      {(providers.google || providers.microsoft || providers.sso) && (
        <div className="mt-3 space-y-2">
          {providers.google && (
            <Button variant="outline" className="w-full" onClick={() => social("google")}>
              <GoogleMark /> Continue with Google
            </Button>
          )}
          {providers.microsoft && (
            <Button variant="outline" className="w-full" onClick={() => social("microsoft")}>
              <MicrosoftMark /> Continue with Microsoft
            </Button>
          )}
          {providers.sso && mode === "sign-in" && (
            <Button variant="outline" className="w-full" onClick={() => setStep("sso")}>
              <KeyRound className="h-4 w-4" /> Sign in with your company (SSO)
            </Button>
          )}
        </div>
      )}
      <p className="mt-4 text-center text-xs text-muted">
        {mode === "sign-in" ? "No account? " : "Have an account? "}
        <Link className="underline" href={`/${other}?next=${encodeURIComponent(safeNext)}`}>
          {mode === "sign-in" ? "Sign up" : "Sign in"}
        </Link>
      </p>
    </Card>
  );
}

function TwoFactorStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [backup, setBackup] = useState(false);
  const [trust, setTrust] = useState(true);
  const [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    setPending(true);
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice: trust })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice: trust });
    setPending(false);
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      // After 5 wrong tries (or ~10 minutes) this sign-in step expires: every code fails until the password is entered again.
      if (code === "INVALID_TWO_FACTOR_COOKIE" || /two factor cookie/i.test(error.message ?? "")) {
        toast.error("This sign-in step has expired", { description: "Too many tries or too much time passed. Enter your password again, then a fresh code.", duration: 10000 });
        return onBack();
      }
      if (error.status === 429) return void toast.error("Too many wrong codes", { description: "Your account is locked for a few minutes. Try again later.", duration: 10000 });
      return void toast.error(backup ? "That backup code didn't work" : "That code didn't match", {
        description: backup ? "Each backup code works once." : "Use the newest SyncSprint entry in your app, and make sure your phone sets its time automatically.",
        duration: 8000,
      });
    }
    onDone();
  }
  return (
    <Card className="w-full max-w-md border-border p-8 shadow-lift">
      <ShieldCheck className="h-8 w-8 text-primary" />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Two-step sign-in</h1>
      <p className="mt-1 text-sm text-muted">
        {backup ? "Enter one of the backup codes you saved. Each works once." : "Enter the 6-digit code from your authenticator app."}
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">{backup ? "Backup code" : "Code"}</Label>
          <Input
            id="code" name="code" required autoFocus autoComplete="one-time-code"
            inputMode={backup ? "text" : "numeric"} pattern={backup ? undefined : "[0-9 ]{6,7}"} maxLength={backup ? 20 : 7}
            className="text-center text-lg tracking-[0.3em]"
          />
        </div>
        <label className="flex items-center gap-2 text-[14px] text-muted">
          <input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} /> Trust this device for 30 days
        </label>
        <Button className="w-full" size="lg" disabled={pending}>{pending ? "Checking…" : "Verify"}</Button>
      </form>
      <div className="mt-4 flex justify-between text-[13.5px]">
        <button className="cursor-pointer text-primary hover:underline" onClick={() => setBackup((b) => !b)}>
          {backup ? "Use the authenticator app" : "Use a backup code"}
        </button>
        <button className="cursor-pointer text-muted hover:underline" onClick={onBack}>Back</button>
      </div>
    </Card>
  );
}

function SsoStep({ callbackURL, onBack }: { callbackURL: string; onBack: () => void }) {
  const [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email")).trim();
    setPending(true);
    const res = await fetch("/api/auth/sign-in/sso", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL }),
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
    setPending(false);
    if (res.status === 404) return void toast.error("Single sign-on isn't set up for that email's company. Sign in with your password, Google or Microsoft, or ask your admin.");
    if (!res.ok || !body.url) return void toast.error(body.message ?? "Couldn't start single sign-on. Try again.");
    window.location.href = body.url;
  }
  return (
    <Card className="w-full max-w-md border-border p-8 shadow-lift">
      <KeyRound className="h-8 w-8 text-primary" />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Sign in with SSO</h1>
      <p className="mt-1 text-sm text-muted">Enter your work email and we'll send you to your company's sign-in page.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="sso-email">Work email</Label>
          <Input id="sso-email" name="email" type="email" required autoFocus autoComplete="email" />
        </div>
        <Button className="w-full" size="lg" disabled={pending}>{pending ? "Finding your company…" : "Continue"}</Button>
      </form>
      <button className="mt-4 cursor-pointer text-[13.5px] text-muted hover:underline" onClick={onBack}>Back</button>
    </Card>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
function MicrosoftMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
      <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
      <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
      <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
    </svg>
  );
}
