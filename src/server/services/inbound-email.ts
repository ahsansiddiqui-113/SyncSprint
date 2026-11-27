import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { auditLogs, boardColumns, orgMembers, projects, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";
import { createTask } from "./tasks";
import { newEffects, type Effects } from "./task-effects";

/**
 * Email-to-task: each project can have a private address like eng-<token>@in.example.com.
 * The mail provider (Postmark, Resend, SendGrid or Mailgun inbound) posts the message to
 * /api/inbound/email; the subject becomes the title, the text the description.
 * Only mail FROM a member of the workspace is accepted (no spam from strangers), and the
 * task is created as that person, so permissions and the audit trail stay intact.
 */

export const inboundDomain = () => process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || null;

export async function getInboundAddress(conn: DB, actorId: string, organizationId: string, projectId: string) {
  await requireOrgPermission(actorId, organizationId, "member", conn);
  const [p] = await conn.select({ key: projects.key, token: projects.inboundEmailToken }).from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
  const domain = inboundDomain();
  return { enabled: !!p.token, address: p.token && domain ? `${p.key.toLowerCase()}-${p.token}@${domain}` : null, configured: !!domain };
}

/** Turn on (or give a new address to) email-to-task. Admins only; the old address stops working. */
export async function rotateInboundAddress(conn: DB, actorId: string, organizationId: string, projectId: string, on: boolean) {
  await requireOrgPermission(actorId, organizationId, "admin", conn);
  const token = on ? randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12).padEnd(12, "0") : null;
  const [p] = await conn.update(projects).set({ inboundEmailToken: token }).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).returning({ id: projects.id });
  if (!p) throw new AppError("NOT_FOUND", "Project not found");
  await conn.insert(auditLogs).values({ organizationId, actorId, action: on ? "INBOUND_EMAIL_ON" : "INBOUND_EMAIL_OFF", entityType: "project", entityId: projectId, metadata: {} });
  return getInboundAddress(conn, actorId, organizationId, projectId);
}

export type InboundMail = { from: string; to: string[]; subject: string; text: string };

/** Accept the shapes the common providers post (JSON or form fields). */
export function normalizeInbound(body: Record<string, unknown>): InboundMail | null {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const emails = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.flatMap((x) => (typeof x === "string" ? emails(x) : x && typeof x === "object" ? emails((x as { Email?: string; email?: string; address?: string }).Email ?? (x as { email?: string }).email ?? (x as { address?: string }).address) : []));
    return str(v).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  };
  // Postmark: From / FromFull / ToFull / Subject / TextBody · Resend & generic: from / to / subject / text · SendGrid & Mailgun: from / to|recipient / subject / text|body-plain
  const from = emails(body.FromFull ?? body.From ?? body.from ?? body.sender)[0];
  const to = [...emails(body.ToFull ?? body.To ?? body.to ?? body.recipient), ...emails(body.CcFull ?? body.Cc ?? body.cc)];
  const subject = str(body.Subject ?? body.subject).trim();
  const text = str(body.TextBody ?? body.text ?? body["stripped-text"] ?? body["body-plain"] ?? body.plain);
  if (!from || !to.length) return null;
  return { from: from.toLowerCase(), to: to.map((t) => t.toLowerCase()), subject, text };
}

/** Strip quoted replies and signatures so the description is just what the person wrote. */
export function cleanBody(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^(--\s?|_{5,})$/.test(l.trim())) break; // signature
    if (/^On .+wrote:$/.test(l.trim()) || /^-----Original Message-----/.test(l.trim())) break; // quoted reply
    if (l.startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").trim().slice(0, 10_000);
}

export async function handleInbound(conn: DB, mail: InboundMail, fx: Effects = newEffects()) {
  const domain = inboundDomain();
  if (!domain) throw new AppError("NOT_FOUND", "Email-to-task isn't configured");
  const addr = mail.to.map((t) => t.toLowerCase()).find((t) => t.endsWith(`@${domain}`));
  const m = addr?.match(/^([a-z][a-z0-9]{1,9})-([a-z0-9]{12})@/);
  if (!m) throw new AppError("NOT_FOUND", "Unknown address");
  const [p] = await conn.select({ id: projects.id, org: projects.organizationId, key: projects.key }).from(projects).where(and(eq(projects.inboundEmailToken, m[2]!), sql`lower(${projects.key}) = ${m[1]}`)).limit(1);
  if (!p) throw new AppError("NOT_FOUND", "Unknown address");
  // The sender must be a member of the workspace; the task is created as them.
  const [sender] = await conn
    .select({ id: users.id, role: orgMembers.role })
    .from(users)
    .innerJoin(orgMembers, and(eq(orgMembers.userId, users.id), eq(orgMembers.organizationId, p.org)))
    .where(sql`lower(${users.email}) = ${mail.from.toLowerCase()}`)
    .limit(1);
  if (!sender) throw new AppError("FORBIDDEN", "Only members of the workspace can email tasks in");
  const [col] = await conn.select({ id: boardColumns.id }).from(boardColumns).where(eq(boardColumns.projectId, p.id)).orderBy(asc(boardColumns.position)).limit(1);
  if (!col) throw new AppError("NOT_FOUND", "Unknown address");
  const title = (mail.subject.replace(/^(re|fwd?|fw):\s*/gi, "").trim() || "Email from " + mail.from).slice(0, 200);
  const task = await createTask(conn, sender.id, { organizationId: p.org, columnId: col.id, title, description: cleanBody(mail.text) || null }, fx);
  await conn.insert(auditLogs).values({ organizationId: p.org, actorId: sender.id, action: "TASK_FROM_EMAIL", entityType: "task", entityId: task.id, metadata: { from: mail.from } });
  return { task, organizationId: p.org, ref: `${p.key}-${task.taskNumber}` };
}
