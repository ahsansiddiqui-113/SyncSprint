import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { AppError } from "@/lib/errors";
import { requireOrgBySlug } from "@/lib/rbac";
import { requireUserOrRedirect } from "@/lib/session";

/**
 * Page-level tenant guard. Non-members get a 404 (not a 403) so the existence
 * of other tenants' slugs is never revealed.
 */
export const loadWorkspace = cache(async (orgSlug: string) => {
  const user = await requireUserOrRedirect(`/w/${orgSlug}`);
  try {
    const { org, role } = await requireOrgBySlug(user.id, orgSlug, "viewer", db);
    return { user, org, role };
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
});

/** Run a service call from an RSC, mapping tenant/RBAC errors to 404. */
export async function orNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) notFound();
    throw err;
  }
}
