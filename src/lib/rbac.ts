import { and, eq } from "drizzle-orm";
import { db as defaultDb, type DbOrTx } from "@/db";
import { orgMembers, organizations, type OrgRole } from "@/db/schema";
import { AppError, type AppErrorCode } from "./errors";

export type { OrgRole };

export { ROLES, ROLE_WEIGHT, PERMISSIONS, hasRole, can, type Permission } from "./rbac-shared";
import { hasRole } from "./rbac-shared";

/**
 * The tenant + RBAC guard. Every server action / protected read calls this first.
 * `organizationId` from the client is never trusted until membership is verified here.
 */
export async function requireOrgPermission(
  userId: string,
  organizationId: string,
  requiredRole: OrgRole,
  conn: DbOrTx = defaultDb
): Promise<OrgRole> {
  const [membership] = await conn
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.organizationId, organizationId)))
    .limit(1);

  if (!membership) throw new AppError("FORBIDDEN_NOT_A_MEMBER");

  if (!hasRole(membership.role, requiredRole)) {
    throw new AppError(`FORBIDDEN_REQUIRES_${requiredRole.toUpperCase()}` as AppErrorCode);
  }
  return membership.role;
}

/** Resolve an org by URL slug and enforce membership in one round trip. */
export async function requireOrgBySlug(
  userId: string,
  slug: string,
  requiredRole: OrgRole = "viewer",
  conn: DbOrTx = defaultDb
) {
  const [row] = await conn
    .select({ org: organizations, role: orgMembers.role })
    .from(organizations)
    .leftJoin(
      orgMembers,
      and(eq(orgMembers.organizationId, organizations.id), eq(orgMembers.userId, userId))
    )
    .where(eq(organizations.slug, slug))
    .limit(1);

  // Same error for "doesn't exist" and "not yours" — don't leak which tenants exist.
  if (!row || !row.role) throw new AppError("FORBIDDEN_NOT_A_MEMBER");
  if (!hasRole(row.role, requiredRole)) {
    throw new AppError(`FORBIDDEN_REQUIRES_${requiredRole.toUpperCase()}` as AppErrorCode);
  }
  return { org: row.org, role: row.role };
}
