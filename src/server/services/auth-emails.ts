import { db as defaultDb, type DB } from "@/db";
import { emailConfigured, sendEmail } from "./outbound";



/** Throwaway 1-click demo accounts live on this non-routable domain; never email them. */
export const DEMO_EMAIL_DOMAIN = "@demo.syncsprint.local";

/**
 * Whether sign-in must wait for a verified email.
 * - Locally (not production): always, so the flow can be tried with the developer outbox.
 * - In production: only once email can actually reach people, i.e. Resend is configured with a
 *   real sending domain. Resend's shared test sender (onboarding@resend.dev) only delivers to the
 *   account owner, so requiring verification with it would stop every new customer from signing up.
 * EMAIL_VERIFICATION=required|optional overrides this.
 */
export function emailVerificationRequired(): boolean {
  const forced = process.env.EMAIL_VERIFICATION?.toLowerCase();
  if (forced === "required") return true;
  if (forced === "optional") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return emailConfigured() && !/resend\.dev/i.test(process.env.EMAIL_FROM ?? "");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "there";

function layout(title: string, intro: string, button: string, url: string, outro: string) {
  return `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#292d34">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e8eaed;border-radius:14px" cellpadding="0" cellspacing="0"><tr><td style="padding:32px">
<div style="font-weight:800;font-size:18px;color:#7b68ee">SyncSprint</div>
<h1 style="font-size:22px;margin:20px 0 8px">${esc(title)}</h1>
<p style="font-size:15px;line-height:1.6;color:#646a73;margin:0 0 24px">${intro}</p>
<a href="${esc(url)}" style="display:inline-block;background:#7b68ee;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${esc(button)}</a>
<p style="font-size:13px;line-height:1.6;color:#8f949c;margin:24px 0 0">${outro}</p>
<p style="font-size:12px;line-height:1.5;color:#8f949c;margin:16px 0 0;word-break:break-all">If the button doesn't work, paste this link into your browser:<br>${esc(url)}</p>
</td></tr></table></td></tr></table></body></html>`;
}

export async function sendVerificationEmail(user: { email: string; name?: string | null }, url: string, conn: DB = defaultDb) {
  if (user.email.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)) return "skipped" as const;
  const hi = `Hi ${firstName(user.name)},`;
  return sendEmail(conn, {
    to: user.email,
    subject: "Confirm your email for SyncSprint",
    text: `${hi}\n\nConfirm this is your email address to finish setting up your SyncSprint account:\n\n${url}\n\nThe link works for 24 hours. If you didn't sign up for SyncSprint, you can ignore this email.`,
    html: layout(
      "Confirm your email",
      `${esc(hi)} confirm this is your email address to finish setting up your SyncSprint account.`,
      "Confirm email",
      url,
      "The link works for 24 hours. If you didn't sign up for SyncSprint, you can ignore this email.",
    ),
  });
}

export async function sendPasswordResetEmail(user: { email: string; name?: string | null }, url: string, conn: DB = defaultDb) {
  if (user.email.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)) return "skipped" as const;
  const hi = `Hi ${firstName(user.name)},`;
  return sendEmail(conn, {
    to: user.email,
    subject: "Reset your SyncSprint password",
    text: `${hi}\n\nSomeone (hopefully you) asked to reset the password for your SyncSprint account. Choose a new one here:\n\n${url}\n\nThe link works for 1 hour and only once. Resetting signs you out on your other devices. If you didn't ask for this, ignore this email; your password stays the same.`,
    html: layout(
      "Reset your password",
      `${esc(hi)} someone (hopefully you) asked to reset the password for your SyncSprint account.`,
      "Choose a new password",
      url,
      "The link works for 1 hour and only once. Resetting signs you out on your other devices. If you didn't ask for this, ignore this email; your password stays the same.",
    ),
  });
}
