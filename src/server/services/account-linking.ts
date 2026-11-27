import { eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { verifications } from "@/db/schema";

type DB = typeof defaultDb;

/**
 * Which sign-in providers may be attached to an existing SyncSprint account.
 *
 * Google confirms email ownership (email_verified), so it links on its own and needs no entry here.
 * Microsoft does not: with "common" tenants anyone can create a directory and put any address in the
 * email claim. So Microsoft is trusted ONLY when the request is the return leg of an explicit
 * "Connect Microsoft" that the account owner started while signed in. Better Auth then still requires
 * the Microsoft email to equal the signed-in user's email and the starting session to be live.
 * A plain "Continue with Microsoft" for an email that already has an account is refused
 * (account_not_linked), and the sign-in page explains how to connect it safely.
 */
export async function linkTrustedProviders(request?: Request, conn: DB = defaultDb): Promise<string[]> {
  if (!request) return [];
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return [];
  }
  if (!url.pathname.endsWith("/callback/microsoft")) return [];
  const state = url.searchParams.get("state");
  if (!state || state.length > 200) return [];
  const [row] = await conn
    .select({ value: verifications.value, expiresAt: verifications.expiresAt })
    .from(verifications)
    .where(eq(verifications.identifier, `auth-state:${state}`))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return [];
  try {
    const data = JSON.parse(row.value) as { link?: { userId?: unknown; email?: unknown } };
    if (data.link && typeof data.link.userId === "string" && typeof data.link.email === "string") return ["microsoft"];
  } catch {
    /* not a link flow */
  }
  return [];
}
