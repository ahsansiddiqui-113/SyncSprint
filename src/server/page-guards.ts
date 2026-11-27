import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { AppError } from "@/lib/errors";
import { requireOrgBySlug } from "@/lib/rbac";
import { requireUserOrRedirect } from "@/lib/session";

/**
 * Page-level tenant guard. Non-members get a 404 (not a 403) so the existence
 * of other tenants' slugs is never revealed. Includes the workspace's billing state.
 */
export const loadWorkspaceAnyState = cache(async (orgSlug: string) => {
  const user = await requireUserOrRedirect(`/w/${orgSlug}`);
  try {
    // "guest" = any membership; guests are sent to their own pages by loadWorkspace below.
    const { org, role, billing, viaSupport } = await requireOrgBySlug(user.id, orgSlug, "guest", db);
    return { user, org, role, billing, viaSupport };
  } catch (err) {
    // Security policy: send them somewhere they can fix it (or at least understand it).
    if (err instanceof AppError && err.code === "TWO_FACTOR_REQUIRED") redirect(`/account/security?required=${encodeURIComponent(orgSlug)}`);
    if (err instanceof AppError && err.code === "IP_NOT_ALLOWED") redirect("/blocked?reason=ip");
    if (err instanceof AppError) notFound();
    throw err;
  }
});

/** Normal pages: a locked workspace sends everyone to the lock screen (admins can still reach Billing). */
export const loadWorkspace = cache(async (orgSlug: string) => {
  const ws = await loadWorkspaceAnyState(orgSlug);
  if (ws.billing.access === "locked") redirect(`/w/${orgSlug}/locked`);
  if (ws.role === "guest") redirect(`/w/${orgSlug}/guest`);
  return ws;
});

/** Run a service call from an RSC, mapping tenant/RBAC errors to 404. */
export async function orNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError && (err.code === "WORKSPACE_LOCKED" || err.code === "WORKSPACE_READ_ONLY")) throw err;
    if (err instanceof AppError) notFound();
    throw err;
  }
}
