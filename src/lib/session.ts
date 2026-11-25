import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { AppError } from "./errors";

/** Per-request memoised session lookup (RSC + server actions). */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** For pages: redirect anonymous visitors to sign-in. */
export async function requireUserOrRedirect(next?: string) {
  const session = await getSession();
  if (!session) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  return session.user;
}

/** For server actions: the actor's id always comes from the session cookie, never the payload. */
export async function requireUserId(): Promise<string> {
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHENTICATED");
  return session.user.id;
}

export async function requireActor(): Promise<{ id: string; name: string }> {
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHENTICATED");
  return { id: session.user.id, name: session.user.name };
}
