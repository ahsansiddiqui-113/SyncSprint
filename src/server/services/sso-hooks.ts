import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, orgMembers, organizations, ssoProviders, users } from "@/db/schema";

/**
 * Hooks Better Auth calls during sign-in (kept here so auth.ts stays small).
 * No "server-only": auth.ts is loaded by server.ts too.
 */

const domainOf = (email: string) => email.split("@")[1]?.toLowerCase().trim() ?? "";
const domainsOf = (field: string) => field.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);

/** Name of a workspace that requires SSO for this person's email domain, or null. */
export async function ssoRequiredFor(userId: string): Promise<string | null> {
  const [u] = await db.select({ email: users.email, isDemo: users.isDemo }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.isDemo) return null;
  const domain = domainOf(u.email);
  if (!domain) return null;
  const rows = await db
    .select({ name: organizations.name, domain: ssoProviders.domain })
    .from(ssoProviders)
    .innerJoin(organizations, eq(organizations.id, ssoProviders.organizationId))
    .where(and(eq(organizations.ssoRequired, true), eq(ssoProviders.domainVerified, true)));
  return rows.find((r) => domainsOf(r.domain).includes(domain))?.name ?? null;
}

/**
 * After an SSO sign-in: make sure the person is a member of the workspace that owns the
 * provider (as a member; admins can change the role). Idempotent; runs on every SSO login.
 */
export async function ssoProvisionUser(data: { user: { id: string; email: string }; provider: { providerId: string } }) {
  const [p] = await db.select({ organizationId: ssoProviders.organizationId, domain: ssoProviders.domain, verified: ssoProviders.domainVerified }).from(ssoProviders).where(eq(ssoProviders.providerId, data.provider.providerId)).limit(1);
  if (!p?.organizationId || !p.verified) return;
  // Only people whose email is on the verified domain(s) join automatically.
  if (!domainsOf(p.domain).includes(domainOf(data.user.email))) return;
  const added = await db.insert(orgMembers).values({ organizationId: p.organizationId, userId: data.user.id, role: "member" }).onConflictDoNothing().returning({ id: orgMembers.id });
  if (added.length) {
    await db.insert(auditLogs).values({ organizationId: p.organizationId, actorId: data.user.id, action: "MEMBER_JOINED_VIA_SSO", entityType: "user", entityId: data.user.id, metadata: { email: data.user.email } });
  }
}

/* ----------------------------- trusted origins ----------------------------- */

// Better Auth only fetches OIDC discovery / token / JWKS from trusted origins. A company's identity
// provider becomes trusted once registered (and just before, while it is being registered).
const pending = new Map<string, number>();
let cache: { at: number; origins: string[] } | null = null;

const originOf = (u: unknown) => {
  try {
    return typeof u === "string" ? new URL(u).origin : null;
  } catch {
    return null;
  }
};

/** Allow an issuer's origin for the next few minutes (call only after an SSRF check). */
export function trustPendingOrigin(url: string) {
  const o = originOf(url);
  if (o) pending.set(o, Date.now() + 5 * 60_000);
  cache = null;
}

export async function ssoTrustedOrigins(): Promise<string[]> {
  const now = Date.now();
  for (const [o, until] of pending) if (until < now) pending.delete(o);
  if (!cache || now - cache.at > 30_000) {
    const rows = await db.select({ issuer: ssoProviders.issuer, oidc: ssoProviders.oidcConfig }).from(ssoProviders).catch(() => []);
    const set = new Set<string>();
    for (const r of rows) {
      const o = originOf(r.issuer);
      if (o) set.add(o);
      if (r.oidc) {
        try {
          const c = JSON.parse(r.oidc) as Record<string, unknown>;
          for (const k of ["discoveryEndpoint", "authorizationEndpoint", "tokenEndpoint", "jwksEndpoint", "userInfoEndpoint"]) {
            const x = originOf(c[k]);
            if (x) set.add(x);
          }
        } catch {}
      }
    }
    cache = { at: now, origins: [...set] };
  }
  return [...new Set([...cache.origins, ...pending.keys()])];
}

/** True when at least one workspace has a verified SSO provider (cached 60 s). */
let availCache: { at: number; on: boolean } | null = null;
export async function ssoAvailable() {
  if (availCache && Date.now() - availCache.at < 60_000) return availCache.on;
  const [p] = await db.select({ id: ssoProviders.id }).from(ssoProviders).where(eq(ssoProviders.domainVerified, true)).limit(1).catch(() => []);
  availCache = { at: Date.now(), on: !!p };
  return availCache.on;
}
