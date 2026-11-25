import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";

const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  appName: "SyncSprint",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
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
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : {},
  session: { expiresIn: 60 * 60 * 24 * 7, cookieCache: { enabled: true, maxAge: 60 } },
  advanced: { database: { generateId: "uuid" } },
  // Must be last: lets server actions set auth cookies via next/headers.
  plugins: [nextCookies()],
});

export const isGoogleEnabled = googleEnabled;
export type AuthSession = typeof auth.$Infer.Session;
