"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { checkSharePassword, resolveShare, unlockProof } from "@/server/services/share-links";

/** Password gate for a share link. Sets a signed, path-scoped cookie on success. */
export async function unlockShareAction(token: string, formData: FormData) {
  const share = await resolveShare(db, token);
  if (!share || !share.link.passwordHash) redirect(`/s/${encodeURIComponent(token)}`);
  const result = checkSharePassword(share.link, String(formData.get("password") ?? "").slice(0, 200));
  if (result !== "ok") redirect(`/s/${encodeURIComponent(token)}?error=${result}`);
  (await cookies()).set(`ss_share_${share.link.id}`, unlockProof(share.link), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/s/${token}`,
    maxAge: 7 * 24 * 3600,
  });
  redirect(`/s/${encodeURIComponent(token)}`);
}
