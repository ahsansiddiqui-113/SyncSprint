import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { desc } from "drizzle-orm";
import { outbox } from "@/db/schema";
import { emailVerificationRequired, sendPasswordResetEmail, sendVerificationEmail } from "@/server/services/auth-emails";
import { testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
beforeAll(async () => {
  db = await testDb();
});
afterEach(() => vi.unstubAllEnvs());

describe("when sign-in must wait for a confirmed email", () => {
  it("is always on outside production, so it can be tried locally", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(emailVerificationRequired()).toBe(true);
  });
  it("stays off in production while email can't reach people", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(emailVerificationRequired()).toBe(false);
    // Resend's shared test sender only delivers to the account owner.
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "SyncSprint <onboarding@resend.dev>");
    expect(emailVerificationRequired()).toBe(false);
  });
  it("turns on in production once a real sending domain is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "SyncSprint <hello@syncsprint.com>");
    expect(emailVerificationRequired()).toBe(true);
  });
  it("can be forced either way", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_VERIFICATION", "required");
    expect(emailVerificationRequired()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EMAIL_VERIFICATION", "optional");
    expect(emailVerificationRequired()).toBe(false);
  });
});

describe("account emails", () => {
  it("send a confirm-email link (to the dev outbox without Resend)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const url = "http://localhost:3000/api/auth/verify-email?token=abc&callbackURL=/w";
    expect(await sendVerificationEmail({ email: "ana@example.com", name: "Ana Ruiz" }, url, db)).toBe("logged");
    const [row] = await db.select().from(outbox).orderBy(desc(outbox.createdAt)).limit(1);
    expect(row!.to).toBe("ana@example.com");
    expect(row!.subject).toBe("Confirm your email for SyncSprint");
    expect(row!.body).toContain(url);
    expect(row!.body).toContain("Hi Ana,");
  });
  it("send a reset link that explains the 1-hour, sign-out-elsewhere rules", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const url = "http://localhost:3000/api/auth/reset-password/tok?callbackURL=/reset-password";
    await sendPasswordResetEmail({ email: "sam@example.com", name: null }, url, db);
    const [row] = await db.select().from(outbox).orderBy(desc(outbox.createdAt)).limit(1);
    expect(row!.subject).toBe("Reset your SyncSprint password");
    expect(row!.body).toContain(url);
    expect(row!.body).toContain("1 hour");
    expect(row!.body).toContain("Hi there,");
  });
  it("never email throwaway demo accounts", async () => {
    const before = await db.select().from(outbox);
    expect(await sendVerificationEmail({ email: "reviewer-ab12@demo.syncsprint.local", name: "Demo" }, "x", db)).toBe("skipped");
    expect(await sendPasswordResetEmail({ email: "REVIEWER-ab12@DEMO.SYNCSPRINT.LOCAL", name: "Demo" }, "x", db)).toBe("skipped");
    expect((await db.select().from(outbox)).length).toBe(before.length);
  });
});
