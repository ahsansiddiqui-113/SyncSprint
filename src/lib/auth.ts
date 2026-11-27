import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { sso } from "@better-auth/sso";
import { ssoProvisionUser, ssoRequiredFor, ssoTrustedOrigins } from "@/server/services/sso-hooks";
import { linkTrustedProviders } from "@/server/services/account-linking";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { appBaseUrl } from "./base-url";

const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const microsoftEnabled = !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);

export const auth = betterAuth({
  appName: "SyncSprint",
  baseURL: appBaseUrl(),
  // Allow this deployment's own URLs (production domain, preview and branch URLs).
  // Plus the identity providers companies register for SSO (needed for OIDC discovery).
  trustedOrigins: async () => [
    ...[process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map((h) => `https://${h}`),
    ...(await ssoTrustedOrigins()),
  ],
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      twoFactor: schema.twoFactors,
      ssoProvider: schema.ssoProviders,
    },
  }),
  user: {
    modelName: "user",
    fields: { image: "avatarUrl" },
    additionalFields: {
      isDemo: { type: "boolean", defaultValue: false, input: false },
    },
  },
  emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
  socialProviders: {
    ...(googleEnabled ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } } : {}),
    ...(microsoftEnabled
      ? {
          microsoft: {
            clientId: process.env.MICROSOFT_CLIENT_ID!,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
            // "common" = any work/school or personal Microsoft account; a tenant id limits it to one company.
            tenantId: process.env.MICROSOFT_TENANT_ID || "common",
          },
        }
      : {}),
  },
  // SSO providers are managed only through our admin screens (server-side, after our own RBAC check).
  disabledPaths: ["/sso/register", "/sso/update-provider", "/sso/delete-provider", "/sso/providers", "/sso/get-provider", "/sso/request-domain-verification", "/sso/verify-domain"],
  databaseHooks: {
    session: {
      create: {
        // A company that requires SSO: people with an email on its verified domain must come in through it.
        before: async (session, ctx) => {
          const path = ctx?.path ?? "";
          if (path.startsWith("/sso/")) return;
          const company = await ssoRequiredFor(session.userId);
          if (company) throw new APIError("FORBIDDEN", { message: `${company} requires signing in with your company account (SSO).` });
        },
      },
    },
  },
  // Attaching Google/Microsoft to an existing account: Google links on its verified email; Microsoft only
  // through an explicit "Connect Microsoft" by the signed-in owner (see linkTrustedProviders).
  account: { accountLinking: { enabled: true, trustedProviders: (request) => linkTrustedProviders(request) } },
  session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: true, maxAge: 60 } },
  advanced: { database: { generateId: "uuid" } },
  plugins: [
    // Two-step sign-in: authenticator app (TOTP) + one-time backup codes; "trust this device" for 30 days.
    twoFactor({ issuer: "SyncSprint", allowPasswordless: true, schema: { twoFactor: { modelName: "twoFactor" } } }),
    // Company single sign-on (OIDC / SAML), one provider per workspace, matched by verified email domain.
    sso({
      domainVerification: { enabled: true },
      organizationProvisioning: { disabled: true }, // we add people to the workspace ourselves (provisionUser)
      provisionUser: ssoProvisionUser,
      provisionUserOnEveryLogin: true,
      providersLimit: 50,
    }),
    // Must be last: lets server actions set auth cookies via next/headers.
    nextCookies(),
  ],
});

export const isGoogleEnabled = googleEnabled;
export const isMicrosoftEnabled = microsoftEnabled;
export type AuthSession = typeof auth.$Infer.Session;
