"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export function AuthForm({ mode, googleEnabled }: { mode: "sign-in" | "sign-up"; googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/w";
  // Only allow same-origin relative redirects (no open redirect via ?next=//evil.com).
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/w";
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    const { error } =
      mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: String(f.get("name")) })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) return void toast.error(error.message ?? "Authentication failed");
    router.push(safeNext);
    router.refresh();
  }

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
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          />
        </div>
        <Button className="mt-2 w-full" size="lg" disabled={pending}>
          {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Sign up"}
        </Button>
      </form>
      {googleEnabled && (
        <Button
          variant="outline"
          className="mt-3 w-full"
          onClick={() => authClient.signIn.social({ provider: "google", callbackURL: safeNext })}
        >
          Continue with Google
        </Button>
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
