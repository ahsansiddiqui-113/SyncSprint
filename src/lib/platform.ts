/**
 * The platform owner: you, the company that sells SyncSprint. Not a workspace role.
 * Can see every customer company's plan and payment status, suspend/reactivate,
 * extend grace, comp a plan, cancel subscriptions and provision new companies.
 * Cannot read customer work unless that company's admin grants temporary support access.
 *
 * Configure with either (comma-separated):
 *   PLATFORM_ADMIN_USER_IDS=<uuid>,...      (safest: sign up, then copy your user id)
 *   PLATFORM_ADMIN_EMAILS=you@company.com   (in production only honoured for verified emails,
 *                                            e.g. Google sign-in, so nobody can claim it by registering first)
 */
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export function isPlatformAdmin(user: { id: string; email: string; emailVerified?: boolean | null } | null | undefined): boolean {
  if (!user) return false;
  if (list(process.env.PLATFORM_ADMIN_USER_IDS).includes(user.id.toLowerCase())) return true;
  if (!list(process.env.PLATFORM_ADMIN_EMAILS).includes(user.email.toLowerCase())) return false;
  return process.env.NODE_ENV !== "production" || user.emailVerified === true;
}
