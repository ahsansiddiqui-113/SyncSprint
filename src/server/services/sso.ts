import { createHash, createHmac, randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import { auditLogs, organizations, ssoProviders } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { assertSafeUrl } from "./webhooks";
import { trustPendingOrigin } from "./sso-hooks";

/**
 * Company single sign-on, one provider per workspace:
 *  - OIDC (Okta, Microsoft Entra ID, Google Workspace, Auth0, Keycloak, JumpCloud…) or SAML 2.0
 *  - the email domain(s) must be proven with a DNS TXT record before anyone can sign in through it
 *  - "require SSO" then refuses password / Google / Microsoft sign-in for that domain
 * SCIM tokens (automatic provisioning) are managed here too.
 */

const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "yandex.com", "mail.com"]);
const hostname = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const providerIdFor = (organizationId: string) => `ws-${organizationId.replace(/-/g, "").slice(0, 12)}`;
const secret = () => process.env.BETTER_AUTH_SECRET || "dev-secret";
/** Deterministic, unguessable proof value for a workspace's domain (nothing to store). */
export const verificationValue = (organizationId: string, domain: string) =>
  createHmac("sha256", secret()).update(`sso-domain:${organizationId}:${domain}`).digest("hex").slice(0, 32);
export const VERIFY_HOST = "_syncsprint-verify";

const parseDomains = (raw: string) => {
  const list = [...new Set(raw.split(/[,\s]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
  if (!list.length) throw new AppError("VALIDATION", "Enter your company's email domain, e.g. acme.com");
  if (list.length > 10) throw new AppError("VALIDATION", "Up to 10 domains");
  for (const d of list) {
    if (!hostname.test(d)) throw new AppError("VALIDATION", `"${d}" isn't a domain`);
    if (PUBLIC_DOMAINS.has(d)) throw new AppError("VALIDATION", `${d} is a public email service; use your company's own domain`);
  }
  return list;
};

export async function getSso(conn: DB, actorId: string, organizationId: string, baseUrl: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const [p] = await conn.select().from(ssoProviders).where(eq(ssoProviders.organizationId, organizationId)).limit(1);
  const providerId = providerIdFor(organizationId);
  const urls = {
    oidcRedirect: `${baseUrl}/api/auth/sso/callback/${providerId}`,
    samlAcs: `${baseUrl}/api/auth/sso/saml2/sp/acs/${providerId}`,
    samlEntityId: `${baseUrl}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`,
  };
  if (!p) return { provider: null, urls };
  const oidc = p.oidcConfig ? (JSON.parse(p.oidcConfig) as { clientId?: string; discoveryEndpoint?: string }) : null;
  const domains = p.domain.split(",").map((d) => d.trim()).filter(Boolean);
  return {
    urls,
    provider: {
      kind: p.samlConfig ? ("saml" as const) : ("oidc" as const),
      issuer: p.issuer,
      domains,
      verified: !!p.domainVerified,
      clientId: oidc?.clientId ?? null,
      records: domains.map((d) => ({ domain: d, host: `${VERIFY_HOST}.${d}`, value: `syncsprint-verify=${verificationValue(organizationId, d)}` })),
    },
  };
}

const oidcInput = z.object({
  kind: z.literal("oidc"),
  domains: z.string(),
  issuer: z.string().url("Issuer must be a URL, e.g. https://acme.okta.com"),
  clientId: z.string().trim().min(1, "Client ID is required").max(300),
  clientSecret: z.string().trim().min(1, "Client secret is required").max(1000),
});
const samlInput = z.object({
  kind: z.literal("saml"),
  domains: z.string(),
  issuer: z.string().trim().min(1, "IdP entity ID is required").max(500),
  entryPoint: z.string().url("Sign-in URL must be a URL"),
  cert: z.string().trim().min(100, "Paste the IdP's signing certificate (PEM)").max(20_000),
});
export const ssoInput = z.discriminatedUnion("kind", [oidcInput, samlInput]);
export type SsoInput = z.input<typeof ssoInput>;

type Register = (body: Record<string, unknown>) => Promise<unknown>;

/**
 * Replace the workspace's provider. `register` is Better Auth's registerSSOProvider bound to the
 * admin's request (it validates the config and runs OIDC discovery); we then link it to the
 * workspace and reset domain verification.
 */
export async function saveSso(conn: DB, actorId: string, organizationId: string, raw: SsoInput, baseUrl: string, register: Register) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const input = ssoInput.parse(raw);
  const domains = parseDomains(input.domains);
  const providerId = providerIdFor(organizationId);
  // Another workspace already proved one of these domains?
  const taken = await conn.select({ domain: ssoProviders.domain }).from(ssoProviders).where(and(eq(ssoProviders.domainVerified, true), ne(ssoProviders.providerId, providerId)));
  const clash = domains.find((d) => taken.some((t) => t.domain.split(",").map((x) => x.trim()).includes(d)));
  if (clash) throw new AppError("CONFLICT", `${clash} is already verified by another workspace`);

  // The identity provider must be a public https host (no SSRF into our network), then it may be fetched.
  if (input.kind === "oidc") {
    await assertSafeUrl(input.issuer);
    trustPendingOrigin(input.issuer);
  }
  await conn.delete(ssoProviders).where(eq(ssoProviders.providerId, providerId));
  const issuer = input.kind === "saml" && !/^https?:\/\//.test(input.issuer) ? `${baseUrl}/saml/${encodeURIComponent(input.issuer)}` : input.issuer;
  try {
    await register({
      providerId,
      issuer,
      domain: domains.join(","),
      ...(input.kind === "oidc"
        ? { oidcConfig: { clientId: input.clientId, clientSecret: input.clientSecret, pkce: true, scopes: ["openid", "email", "profile"] } }
        : {
            samlConfig: {
              entryPoint: input.entryPoint,
              cert: input.cert,
              callbackUrl: `${baseUrl}/w`,
              audience: `${baseUrl}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`,
              idpMetadata: { entityID: input.issuer, cert: input.cert, singleSignOnService: [{ Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect", Location: input.entryPoint }] },
              spMetadata: { entityID: `${baseUrl}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}` },
              mapping: { id: "nameID", email: "email", name: "displayName", firstName: "givenName", lastName: "surname" },
            },
          }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "The identity provider settings were refused";
    throw new AppError("VALIDATION", msg.includes("discovery") || msg.includes("Discovery") ? `Couldn't read the issuer's OpenID configuration (${issuer}/.well-known/openid-configuration). Check the issuer URL.` : msg);
  }
  await conn.update(ssoProviders).set({ organizationId, domainVerified: false, userId: actorId }).where(eq(ssoProviders.providerId, providerId));
  await conn.update(organizations).set({ ssoRequired: false }).where(eq(organizations.id, organizationId));
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "SSO_CONFIGURED", entityType: "organization", entityId: organizationId, metadata: { kind: input.kind, domains } });
}

type Resolver = (host: string) => Promise<string[][]>;

/** Check every domain's TXT record; all must match before SSO sign-in is allowed. */
export async function verifySsoDomains(conn: DB, actorId: string, organizationId: string, resolve: Resolver = dns.resolveTxt) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const [p] = await conn.select().from(ssoProviders).where(eq(ssoProviders.organizationId, organizationId)).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Set up single sign-on first");
  const missing: string[] = [];
  for (const d of p.domain.split(",").map((x) => x.trim()).filter(Boolean)) {
    const want = `syncsprint-verify=${verificationValue(organizationId, d)}`;
    const records = await resolve(`${VERIFY_HOST}.${d}`).then((r) => r.map((parts) => parts.join("")), () => [] as string[]);
    if (!records.includes(want)) missing.push(d);
  }
  if (missing.length) throw new AppError("VALIDATION", `No matching TXT record found yet for ${missing.join(", ")}. DNS changes can take a few minutes to appear.`);
  await conn.update(ssoProviders).set({ domainVerified: true }).where(eq(ssoProviders.id, p.id));
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "SSO_DOMAIN_VERIFIED", entityType: "organization", entityId: organizationId, metadata: { domains: p.domain } });
}

/** Local development only: there is no DNS to prove a domain from localhost. */
export async function devMarkVerified(conn: DB, actorId: string, organizationId: string) {
  if (process.env.NODE_ENV === "production") throw new AppError("FORBIDDEN");
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  await conn.update(ssoProviders).set({ domainVerified: true }).where(eq(ssoProviders.organizationId, organizationId));
}

export async function removeSso(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  await conn.delete(ssoProviders).where(eq(ssoProviders.organizationId, organizationId));
  await conn.update(organizations).set({ ssoRequired: false }).where(eq(organizations.id, organizationId));
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "SSO_REMOVED", entityType: "organization", entityId: organizationId, metadata: {} });
}

export async function setSsoRequired(conn: DB, actorId: string, organizationId: string, on: boolean) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  if (on) {
    const [p] = await conn.select({ verified: ssoProviders.domainVerified }).from(ssoProviders).where(eq(ssoProviders.organizationId, organizationId)).limit(1);
    if (!p?.verified) throw new AppError("VALIDATION", "Verify your domain before requiring single sign-on");
  }
  await conn.update(organizations).set({ ssoRequired: on }).where(eq(organizations.id, organizationId));
  await conn.insert(auditLogs).values({ organizationId, actorId, action: on ? "SSO_REQUIRED" : "SSO_OPTIONAL", entityType: "organization", entityId: organizationId, metadata: {} });
}

/* ------------------------------------ SCIM ------------------------------------ */

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** New SCIM token (shown once). Replaces any previous one. */
export async function rotateScimToken(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  const token = `scim_${randomBytes(24).toString("base64url")}`;
  await conn.update(organizations).set({ scimTokenHash: hashToken(token) }).where(eq(organizations.id, organizationId));
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "SCIM_TOKEN_CREATED", entityType: "organization", entityId: organizationId, metadata: {} });
  return token;
}

export async function disableScim(conn: DB, actorId: string, organizationId: string) {
  await requireOrgPermission(actorId, organizationId, "admin", conn, { billingExempt: true });
  await conn.update(organizations).set({ scimTokenHash: null }).where(eq(organizations.id, organizationId));
  await conn.insert(auditLogs).values({ organizationId, actorId, action: "SCIM_DISABLED", entityType: "organization", entityId: organizationId, metadata: {} });
}
