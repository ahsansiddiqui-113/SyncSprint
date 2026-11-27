import { and, eq } from "drizzle-orm";
import { db as defaultDb, type DbOrTx } from "@/db";
import { orgMembers, organizations, users, type OrgRole, type Organization } from "@/db/schema";
import { AppError, type AppErrorCode } from "./errors";
import { billingState, type BillingState } from "./billing-rules";
import { isPlatformAdmin } from "./platform";
import { ipAllowed } from "./ip";
import { currentRequestIp } from "./request-ip";

export type { OrgRole };

export { ROLES, ROLE_WEIGHT, PERMISSIONS, hasRole, can, type Permission } from "./rbac-shared";
import { hasRole } from "./rbac-shared";

export type GuardOptions = {
  /**
   * Billing and membership management must keep working while a workspace is
   * read-only or locked (so an admin can pay, or remove people to fit a plan).
   */
  billingExempt?: boolean;
};

const billingCols = {
  isDemo: organizations.isDemo,
  plan: organizations.plan,
  billingStatus: organizations.billingStatus,
  trialEndsAt: organizations.trialEndsAt,
  currentPeriodEnd: organizations.currentPeriodEnd,
  cancelAtPeriodEnd: organizations.cancelAtPeriodEnd,
  graceEndsAt: organizations.graceEndsAt,
  suspendedAt: organizations.suspendedAt,
  createdAt: organizations.createdAt,
  supportAccessUntil: organizations.supportAccessUntil,
  require2fa: organizations.require2fa,
  ipAllowlist: organizations.ipAllowlist,
};

/**
 * Workspace security policy, on top of role and billing:
 *  - require2fa: the person must have two-step sign-in on
 *  - ipAllowlist: the request must come from an allowed address (skipped outside a request,
 *    e.g. the scheduler, where there is no caller)
 * The demo workspace is exempt.
 */
export async function enforcePolicy(org: { isDemo: boolean; require2fa: boolean; ipAllowlist: string | null }, twoFactorEnabled: boolean) {
  if (org.isDemo) return;
  if (org.require2fa && !twoFactorEnabled) {
    throw new AppError("TWO_FACTOR_REQUIRED", "This workspace requires two-step sign-in. Turn it on in your account settings.");
  }
  if (org.ipAllowlist?.trim()) {
    const ip = await currentRequestIp();
    if (ip !== undefined && !ipAllowed(ip, org.ipAllowlist)) {
      throw new AppError("IP_NOT_ALLOWED", "This workspace can only be opened from approved networks.");
    }
  }
}

/**
 * Apply the billing access level on top of RBAC:
 *  - read-only: reads (viewer-level) only; anything needing member+ is refused
 *  - locked: nothing, except billing-exempt operations for admins
 */
function enforceBilling(state: BillingState, role: OrgRole, requiredRole: OrgRole, opts: GuardOptions) {
  if (state.access === "full") return;
  if (opts.billingExempt && hasRole(role, "admin")) return;
  if (state.access === "locked") throw new AppError("WORKSPACE_LOCKED", state.message ?? "This workspace is locked.");
  if (hasRole(requiredRole, "member")) throw new AppError("WORKSPACE_READ_ONLY", state.message ?? "This workspace is read-only.");
}

/** Platform-owner support access: read-only, only while the company's admin allows it. */
async function supportRole(conn: DbOrTx, userId: string, org: { supportAccessUntil: Date | null }): Promise<OrgRole | null> {
  if (!org.supportAccessUntil || org.supportAccessUntil.getTime() <= Date.now()) return null;
  const [u] = await conn.select({ id: users.id, email: users.email, emailVerified: users.emailVerified }).from(users).where(eq(users.id, userId)).limit(1);
  return isPlatformAdmin(u) ? "viewer" : null;
}

/**
 * The tenant + RBAC + billing guard. Every server action / protected read calls this first.
 * `organizationId` from the client is never trusted until membership is verified here.
 */
export async function requireOrgPermission(
  userId: string,
  organizationId: string,
  requiredRole: OrgRole,
  conn: DbOrTx = defaultDb,
  opts: GuardOptions = {}
): Promise<OrgRole> {
  const [row] = await conn
    .select({ role: orgMembers.role, org: billingCols, twoFactorEnabled: users.twoFactorEnabled })
    .from(organizations)
    .leftJoin(orgMembers, and(eq(orgMembers.organizationId, organizations.id), eq(orgMembers.userId, userId)))
    .leftJoin(users, eq(users.id, userId))
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const role = row?.role ?? (row ? await supportRole(conn, userId, row.org) : null);
  if (!row || !role) throw new AppError("FORBIDDEN_NOT_A_MEMBER");
  if (!hasRole(role, requiredRole)) {
    throw new AppError(`FORBIDDEN_REQUIRES_${requiredRole === "owner" ? "ADMIN" : requiredRole.toUpperCase()}` as AppErrorCode);
  }
  await enforcePolicy(row.org, !!row.twoFactorEnabled);
  enforceBilling(billingState(row.org), role, requiredRole, opts);
  return role;
}

/**
 * Resolve an org by URL slug and enforce membership in one round trip. Pages get the
 * billing state instead of an error, so they can show the read-only / locked screens.
 */
export async function requireOrgBySlug(
  userId: string,
  slug: string,
  requiredRole: OrgRole = "viewer",
  conn: DbOrTx = defaultDb
): Promise<{ org: Organization; role: OrgRole; billing: BillingState; viaSupport: boolean }> {
  const [row] = await conn
    .select({ org: organizations, role: orgMembers.role, twoFactorEnabled: users.twoFactorEnabled })
    .from(organizations)
    .leftJoin(orgMembers, and(eq(orgMembers.organizationId, organizations.id), eq(orgMembers.userId, userId)))
    .leftJoin(users, eq(users.id, userId))
    .where(eq(organizations.slug, slug))
    .limit(1);

  const support = row && !row.role ? await supportRole(conn, userId, row.org) : null;
  const role = row?.role ?? support;
  // Same error for "doesn't exist" and "not yours": don't leak which tenants exist.
  if (!row || !role) throw new AppError("FORBIDDEN_NOT_A_MEMBER");
  if (!hasRole(role, requiredRole)) {
    throw new AppError(`FORBIDDEN_REQUIRES_${requiredRole.toUpperCase()}` as AppErrorCode);
  }
  await enforcePolicy(row.org, !!row.twoFactorEnabled);
  return { org: row.org, role, billing: billingState(row.org), viaSupport: !!support };
}
