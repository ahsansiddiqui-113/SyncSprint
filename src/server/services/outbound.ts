import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db";
import {
  boardColumns, calendarFeeds, notificationPrefs, notifications, orgMembers, organizations, outbox, projects, pushSubscriptions,
  schedulerLeases, taskAssignees, tasks, timeOff, users,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { requireOrgPermission } from "@/lib/rbac";

/**
 * Reaching people outside the app:
 *  - email (Resend when RESEND_API_KEY + EMAIL_FROM are set; otherwise written to the dev outbox)
 *  - browser push (Web Push with VAPID keys; installable app)
 *  - WhatsApp (Meta Cloud API template message when configured)
 *  - daily / weekly email digests
 *  - a private calendar (ICS) feed of due dates and time off
 * In-app notifications stay the source of truth: the scheduler sweeps new ones every minute
 * and fans them out by each person's preferences, so nothing is sent for a change that rolled back.
 */

const isProd = () => process.env.NODE_ENV === "production";
const base = () => process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000";

/* ---------------------------------- email ---------------------------------- */

export const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(conn: DB, msg: { to: string; subject: string; text: string; html?: string }) {
  const subject = msg.subject.slice(0, 300);
  if (!emailConfigured()) {
    await conn.insert(outbox).values({ channel: "email", to: msg.to, subject, body: isProd() ? null : msg.text.slice(0, 20_000), status: "logged" });
    return "logged" as const;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [msg.to], subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10_000),
    });
    const ok = res.ok;
    // The text is kept only in development, so links in sent or failed mail can still be followed locally.
    await conn.insert(outbox).values({ channel: "email", to: msg.to, subject, body: isProd() ? null : msg.text.slice(0, 20_000), status: ok ? "sent" : "failed", error: ok ? null : `HTTP ${res.status}` });
    return ok ? ("sent" as const) : ("failed" as const);
  } catch (err) {
    await conn.insert(outbox).values({ channel: "email", to: msg.to, subject, body: isProd() ? null : msg.text.slice(0, 20_000), status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : "error" });
    return "failed" as const;
  }
}

/* --------------------------------- whatsapp --------------------------------- */

export const whatsappConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Use the international format, e.g. +923001234567");

/** Business-initiated WhatsApp messages must use an approved template with one text parameter. */
export async function sendWhatsApp(conn: DB, to: string, text: string) {
  const body = text.slice(0, 900);
  if (!whatsappConfigured()) {
    await conn.insert(outbox).values({ channel: "whatsapp", to, subject: body.slice(0, 300), body: isProd() ? null : body, status: "logged" });
    return "logged" as const;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template",
        template: { name: process.env.WHATSAPP_TEMPLATE || "task_update", language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: body }] }] },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    await conn.insert(outbox).values({ channel: "whatsapp", to, subject: body.slice(0, 300), body: null, status: res.ok ? "sent" : "failed", error: res.ok ? null : `HTTP ${res.status}` });
    return res.ok ? ("sent" as const) : ("failed" as const);
  } catch (err) {
    await conn.insert(outbox).values({ channel: "whatsapp", to, subject: body.slice(0, 300), body: null, status: "failed", error: err instanceof Error ? err.message.slice(0, 500) : "error" });
    return "failed" as const;
  }
}

/* ----------------------------------- push ----------------------------------- */

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY ?? null;

const subSchema = z.object({ endpoint: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "Push endpoint must be https"), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });

export async function savePushSubscription(conn: DB, userId: string, raw: unknown, userAgent: string | null) {
  const s = subSchema.parse(raw);
  const [{ n }] = (await conn.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))) as [{ n: number }];
  if (n >= 20) await conn.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), inArray(pushSubscriptions.id, conn.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).orderBy(asc(pushSubscriptions.createdAt)).limit(1))));
  await conn
    .insert(pushSubscriptions)
    .values({ userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: s.keys.p256dh, auth: s.keys.auth } });
}

export async function removePushSubscription(conn: DB, userId: string, endpoint: string) {
  await conn.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function sendPush(conn: DB, userId: string, payload: { title: string; body: string; url: string; tag?: string }) {
  if (!pushConfigured()) return 0;
  const subs = await conn.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (!subs.length) return 0;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:support@${new URL(base()).hostname}`, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await conn.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)); // unsubscribed / expired
    }
  }));
  return sent;
}

/* -------------------------------- preferences -------------------------------- */

export type Prefs = { emailInstant: boolean; digest: "off" | "daily" | "weekly"; push: boolean; whatsapp: boolean; whatsappPhone: string | null };
const DEFAULTS: Prefs = { emailInstant: false, digest: "off", push: true, whatsapp: false, whatsappPhone: null };

export async function getPrefs(conn: DB, userId: string) {
  const orgs = await conn
    .select({ id: organizations.id, name: organizations.name, p: notificationPrefs })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.organizationId))
    .leftJoin(notificationPrefs, and(eq(notificationPrefs.organizationId, orgMembers.organizationId), eq(notificationPrefs.userId, userId)))
    .where(eq(orgMembers.userId, userId))
    .orderBy(asc(organizations.name));
  const subs = await conn.select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, userAgent: pushSubscriptions.userAgent }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  return {
    workspaces: orgs.map((o) => ({ organizationId: o.id, name: o.name, prefs: o.p ? { emailInstant: o.p.emailInstant, digest: o.p.digest, push: o.p.push, whatsapp: o.p.whatsapp, whatsappPhone: o.p.whatsappPhone } : DEFAULTS })),
    devices: subs.map((s) => ({ id: s.id, endpoint: s.endpoint, userAgent: s.userAgent })),
    channels: { email: emailConfigured(), push: pushConfigured(), whatsapp: whatsappConfigured() },
    vapidPublicKey: vapidPublicKey(),
  };
}

export async function setPrefs(conn: DB, userId: string, organizationId: string, raw: Prefs) {
  const p = z.object({ emailInstant: z.boolean(), digest: z.enum(["off", "daily", "weekly"]), push: z.boolean(), whatsapp: z.boolean(), whatsappPhone: z.string().trim().max(20).nullable() }).parse(raw);
  await requireOrgPermission(userId, organizationId, "guest", conn).catch(async (err) => {
    // Guests and viewers alike may set their own preferences: membership is what matters.
    const [m] = await conn.select({ id: orgMembers.id }).from(orgMembers).where(and(eq(orgMembers.organizationId, organizationId), eq(orgMembers.userId, userId))).limit(1);
    if (!m) throw err;
  });
  const phone = p.whatsappPhone ? phoneSchema.parse(p.whatsappPhone.replace(/[\s-]/g, "")) : null;
  if (p.whatsapp && !phone) throw new AppError("VALIDATION", "Add your WhatsApp number to turn WhatsApp on");
  await conn
    .insert(notificationPrefs)
    .values({ userId, organizationId, ...p, whatsappPhone: phone })
    .onConflictDoUpdate({ target: [notificationPrefs.userId, notificationPrefs.organizationId], set: { ...p, whatsappPhone: phone } });
}

/* ------------------------------ notification fan-out ------------------------------ */

const SWEEP = "outbound-sweep";

/**
 * Deliver notifications created since the last sweep by email / push / WhatsApp, per preferences.
 * The watermark lives in scheduler_leases.lastRunAt; at most 1000 per sweep.
 */
export async function fanOutNotifications(conn: DB, now = new Date()) {
  await conn.insert(schedulerLeases).values({ name: SWEEP, lockedUntil: new Date(0), lastRunAt: now }).onConflictDoNothing();
  const [lease] = await conn.select().from(schedulerLeases).where(eq(schedulerLeases.name, SWEEP)).limit(1);
  const since = lease?.lastRunAt ?? now;
  const rows = await conn
    .select({ n: notifications, email: users.email, name: users.name, prefs: notificationPrefs, org: organizations.name })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .innerJoin(organizations, eq(organizations.id, notifications.organizationId))
    .leftJoin(notificationPrefs, and(eq(notificationPrefs.userId, notifications.userId), eq(notificationPrefs.organizationId, notifications.organizationId)))
    .where(and(gt(notifications.createdAt, since), lte(notifications.createdAt, now)))
    .orderBy(asc(notifications.createdAt))
    .limit(1000);
  const watermark = rows.length === 1000 ? rows[rows.length - 1]!.n.createdAt : now;
  await conn.update(schedulerLeases).set({ lastRunAt: watermark }).where(eq(schedulerLeases.name, SWEEP));

  let email = 0, push = 0, whatsapp = 0;
  for (const r of rows) {
    const p = r.prefs ?? { ...DEFAULTS };
    const url = `${base()}${r.n.link ?? "/w"}`;
    const text = [r.n.title, r.n.body].filter(Boolean).join("\n");
    if (p.push) push += await sendPush(conn, r.n.userId, { title: r.n.title, body: r.n.body ?? r.org, url, tag: r.n.taskId ?? r.n.id });
    if (p.emailInstant && r.email && !r.email.endsWith(".local")) {
      await sendEmail(conn, { to: r.email, subject: `[${r.org}] ${r.n.title}`, text: `${text}\n\nOpen: ${url}\n\nChange what you get: ${base()}/account/notifications` });
      email++;
    }
    if (p.whatsapp && p.whatsappPhone) {
      await sendWhatsApp(conn, p.whatsappPhone, `${r.org}: ${text} ${url}`);
      whatsapp++;
    }
  }
  return { notifications: rows.length, email, push, whatsapp };
}

/* ---------------------------------- digests ---------------------------------- */

/** Daily / weekly email: unread notifications, overdue and due-soon work assigned to you. */
export async function sendDigests(conn: DB, now = new Date()) {
  const due = await conn
    .select({ p: notificationPrefs, email: users.email, name: users.name, org: organizations.name, slug: organizations.slug })
    .from(notificationPrefs)
    .innerJoin(users, eq(users.id, notificationPrefs.userId))
    .innerJoin(organizations, eq(organizations.id, notificationPrefs.organizationId))
    .where(and(inArray(notificationPrefs.digest, ["daily", "weekly"]), or(isNull(notificationPrefs.lastDigestAt), lte(notificationPrefs.lastDigestAt, new Date(now.getTime() - 20 * 3_600_000)))));
  let sent = 0;
  const today = now.toISOString().slice(0, 10);
  const soon = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  for (const d of due) {
    if (d.p.digest === "weekly" && d.p.lastDigestAt && now.getTime() - d.p.lastDigestAt.getTime() < 6.5 * 86_400_000) continue;
    const unread = await conn.select({ title: notifications.title }).from(notifications)
      .where(and(eq(notifications.userId, d.p.userId), eq(notifications.organizationId, d.p.organizationId), isNull(notifications.readAt))).orderBy(desc(notifications.createdAt)).limit(15);
    const mine = await myOpenTasks(conn, d.p.userId, d.p.organizationId);
    const overdue = mine.filter((t) => t.dueDate && t.dueDate < today);
    const dueSoon = mine.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= soon);
    await conn.update(notificationPrefs).set({ lastDigestAt: now }).where(and(eq(notificationPrefs.userId, d.p.userId), eq(notificationPrefs.organizationId, d.p.organizationId)));
    if (!unread.length && !overdue.length && !dueSoon.length) continue; // nothing to say: don't send an empty email
    const line = (t: { ref: string; title: string; dueDate: string | null }) => `  • ${t.ref} ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}`;
    const text = [
      `Hi ${d.name.split(" ")[0]}, here's your ${d.p.digest} summary for ${d.org}.`,
      overdue.length ? `\nOverdue (${overdue.length}):\n${overdue.slice(0, 15).map(line).join("\n")}` : "",
      dueSoon.length ? `\nDue in the next 2 days (${dueSoon.length}):\n${dueSoon.slice(0, 15).map(line).join("\n")}` : "",
      unread.length ? `\nUnread in your inbox (${unread.length}):\n${unread.map((u) => `  • ${u.title}`).join("\n")}` : "",
      `\nOpen ${d.org}: ${base()}/w/${d.slug}\nChange or stop these emails: ${base()}/account/notifications`,
    ].filter(Boolean).join("\n");
    if (d.email.endsWith(".local")) continue;
    await sendEmail(conn, { to: d.email, subject: `Your ${d.p.digest} SyncSprint summary: ${d.org}`, text });
    sent++;
  }
  return sent;
}

async function myOpenTasks(conn: DB, userId: string, organizationId?: string) {
  const co = conn.select({ id: taskAssignees.taskId }).from(taskAssignees).where(eq(taskAssignees.userId, userId));
  const lastCol = sql`(select bc.id from board_columns bc where bc.project_id = ${tasks.projectId} order by bc.position desc limit 1)`;
  return conn
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, startDate: tasks.startDate, number: tasks.taskNumber, key: projects.key, slug: organizations.slug, org: organizations.name, status: boardColumns.title, ref: sql<string>`${projects.key} || '-' || ${tasks.taskNumber}` })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(organizations, eq(organizations.id, tasks.organizationId))
    .innerJoin(boardColumns, eq(boardColumns.id, tasks.columnId))
    .innerJoin(orgMembers, and(eq(orgMembers.organizationId, tasks.organizationId), eq(orgMembers.userId, userId)))
    .where(and(
      organizationId ? eq(tasks.organizationId, organizationId) : undefined,
      or(eq(tasks.assigneeId, userId), inArray(tasks.id, co)),
      sql`${tasks.columnId} <> ${lastCol}`,
    ))
    .orderBy(asc(tasks.dueDate))
    .limit(500);
}

/* -------------------------------- calendar feed -------------------------------- */

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** A new private feed URL (the old one stops working). */
export async function rotateCalendarFeed(conn: DB, userId: string) {
  const token = randomBytes(24).toString("base64url");
  await conn.insert(calendarFeeds).values({ userId, tokenHash: hashToken(token) }).onConflictDoUpdate({ target: calendarFeeds.userId, set: { tokenHash: hashToken(token), createdAt: new Date() } });
  return token;
}
export async function revokeCalendarFeed(conn: DB, userId: string) {
  await conn.delete(calendarFeeds).where(eq(calendarFeeds.userId, userId));
}
export async function hasCalendarFeed(conn: DB, userId: string) {
  return (await conn.select({ u: calendarFeeds.userId }).from(calendarFeeds).where(eq(calendarFeeds.userId, userId)).limit(1)).length > 0;
}

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (iso: string) => iso.replace(/-/g, "");
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** Lines longer than 75 octets are folded (RFC 5545 §3.1). */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join("\r\n");
};

/** The ICS document for a feed token, or null if the token is unknown. */
export async function calendarIcs(conn: DB, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [feed] = await conn.select().from(calendarFeeds).where(eq(calendarFeeds.tokenHash, hashToken(token))).limit(1);
  if (!feed) return null;
  const mine = (await myOpenTasks(conn, feed.userId)).filter((t) => t.dueDate);
  const off = await conn
    .select({ id: timeOff.id, start: timeOff.startDate, end: timeOff.endDate, kind: timeOff.kind, org: organizations.name })
    .from(timeOff)
    .innerJoin(organizations, eq(organizations.id, timeOff.organizationId))
    .innerJoin(orgMembers, and(eq(orgMembers.organizationId, timeOff.organizationId), eq(orgMembers.userId, feed.userId)))
    .where(or(eq(timeOff.userId, feed.userId), isNull(timeOff.userId)));
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const host = new URL(base()).hostname;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SyncSprint//Tasks//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:SyncSprint", "X-PUBLISHED-TTL:PT1H", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ...mine.flatMap((t) => [
      "BEGIN:VEVENT", `UID:task-${t.id}@${host}`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(t.dueDate!)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(t.dueDate!))}`,
      `SUMMARY:${icsText(`${t.ref} ${t.title}`)}`, `DESCRIPTION:${icsText(`${t.org} · ${t.status}\n${base()}/w/${t.slug}/projects/${t.key}?task=${t.id}`)}`,
      `URL:${base()}/w/${t.slug}/projects/${t.key}?task=${t.id}`, "TRANSP:TRANSPARENT", "END:VEVENT",
    ]),
    ...off.flatMap((o) => [
      "BEGIN:VEVENT", `UID:off-${o.id}@${host}`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(o.start)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(o.end))}`,
      `SUMMARY:${icsText(o.kind === "holiday" ? `Holiday (${o.org})` : `Time off: ${o.kind}`)}`, "TRANSP:OPAQUE", "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Dev outbox (never in production): the last messages we would have sent. */
export async function devOutbox(conn: DB) {
  if (isProd()) throw new AppError("NOT_FOUND");
  return conn.select().from(outbox).orderBy(desc(outbox.createdAt)).limit(50);
}
