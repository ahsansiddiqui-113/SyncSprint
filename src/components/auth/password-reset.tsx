"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, KeyRound, MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

/** Step 1: ask for the email. The reply never says whether an account exists. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" });
    setPending(false);
    if (error?.status === 429) return void toast.error("Too many requests. Please wait a minute and try again.");
    // Any other outcome shows the same message, so this page can't be used to find out who has an account.
    setSent(true);
  }

  if (sent)
    return (
      <Card className="w-full max-w-md border-border p-8 shadow-lift">
        <MailCheck className="h-8 w-8 text-primary" />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          If <b className="text-foreground">{email.trim()}</b> has a SyncSprint account with a password, we&apos;ve sent a link to choose a new one. It works for 1 hour.
        </p>
        <p className="mt-3 text-[14px] leading-relaxed text-subtle">
          Nothing there? Check spam, or try again in a minute. If you always signed in with Google or Microsoft, use that button on the sign-in page instead.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setSent(false)}>Try another email</Button>
          <Link href="/sign-in" className="self-center text-[14px] text-muted hover:underline">Back to sign in</Link>
        </div>
      </Card>
    );

  return (
    <Card className="w-full max-w-md border-border p-8 shadow-lift">
      <KeyRound className="h-8 w-8 text-primary" />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Forgot your password?</h1>
      <p className="mt-1 text-sm text-muted">Enter the email you sign in with and we&apos;ll send you a link to choose a new password.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button className="w-full" size="lg" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted">
        Remembered it? <Link className="underline" href="/sign-in">Sign in</Link>
      </p>
    </Card>
  );
}

/** Step 2: the link from the email lands here with ?token=… (or ?error=INVALID_TOKEN). */
export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const linkError = params.get("error");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (!token || linkError)
    return (
      <Card className="w-full max-w-md border-border p-8 shadow-lift">
        <KeyRound className="h-8 w-8 text-primary" />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">This link doesn&apos;t work any more</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Reset links work once and for 1 hour. Ask for a new one and use the newest email.
        </p>
        <Link href="/forgot-password" className="mt-6 inline-flex h-12 items-center rounded-xl bg-primary px-6 text-[17px] font-medium text-white hover:bg-primary-dark">
          Send a new link
        </Link>
      </Card>
    );

  if (done)
    return (
      <Card className="w-full max-w-md border-border p-8 shadow-lift">
        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Password changed</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">You&apos;ve been signed out on your other devices. Sign in with your new password.</p>
        <Button className="mt-6 w-full" size="lg" onClick={() => router.push("/sign-in")}>Sign in</Button>
      </Card>
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return void toast.error("Use at least 8 characters");
    if (pw !== pw2) return void toast.error("The two passwords don't match");
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: pw, token: token! });
    setPending(false);
    if (error) {
      if (error.code === "INVALID_TOKEN" || error.status === 400) return void router.replace("/reset-password?error=INVALID_TOKEN");
      return void toast.error(error.message ?? "Couldn't change the password");
    }
    setDone(true);
  }

  return (
    <Card className="w-full max-w-md border-border p-8 shadow-lift">
      <KeyRound className="h-8 w-8 text-primary" />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted">At least 8 characters. You&apos;ll be signed out everywhere else.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" required minLength={8} autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Repeat new password</Label>
          <Input id="confirm-password" type="password" required minLength={8} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        <Button className="w-full" size="lg" disabled={pending}>{pending ? "Saving…" : "Change password"}</Button>
      </form>
    </Card>
  );
}
