/**
 * Mention + duration helpers shared by client and server.
 * Mentions are stored inline as @[Display Name](user-uuid); the editor shows "@Display Name".
 */

export const MENTION_SOURCE = String.raw`@\[([^\]\n]{1,80})\]\(([0-9a-f-]{36})\)`;

export type MentionPart = { kind: "text"; text: string } | { kind: "mention"; name: string; userId: string };

/** Split a stored comment into text and mention parts for rendering. */
export function parseMentions(body: string): MentionPart[] {
  const re = new RegExp(MENTION_SOURCE, "gi");
  const parts: MentionPart[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    if (m.index! > last) parts.push({ kind: "text", text: body.slice(last, m.index) });
    parts.push({ kind: "mention", name: m[1]!, userId: m[2]!.toLowerCase() });
    last = m.index! + m[0].length;
  }
  if (last < body.length) parts.push({ kind: "text", text: body.slice(last) });
  return parts;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turn the editor's "@Sara Khan" text into stored tokens for the people actually
 * picked from the list. Longest names first so "@Sara Khan" beats "@Sara".
 */
export function encodeMentions(text: string, picked: { id: string; name: string }[]) {
  let out = text;
  const byLength = [...new Map(picked.map((p) => [p.name, p])).values()].sort((a, b) => b.name.length - a.name.length);
  for (const p of byLength) {
    const re = new RegExp(`(^|[^\\w\\[])@${escapeRe(p.name)}(?![\\w])`, "g");
    out = out.replace(re, (_, pre: string) => `${pre}@[${p.name.replace(/[\]\n]/g, "")}](${p.id})`);
  }
  return out;
}

/** The "@query" being typed right before the caret, if any. */
export function activeMentionQuery(textBeforeCaret: string): string | null {
  const m = /(?:^|\s)@([^\s@[\]()]{0,30})$/.exec(textBeforeCaret);
  return m ? m[1]! : null;
}

/**
 * Parse a human duration into minutes: "90", "90m", "1.5h", "1h 30m", "1:30", "2h".
 * Returns null when it can't be read or is outside 1 minute .. 24 hours.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  let minutes: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2}):([0-5]\d)$/.exec(s))) minutes = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?(?:\s*(\d{1,2})\s*m(?:in(?:utes?|s)?)?)?$/.exec(s))) minutes = Number(m[1]) * 60 + Number(m[2] ?? 0);
  else if ((m = /^(\d+)\s*m(?:in(?:utes?|s)?)?$/.exec(s))) minutes = Number(m[1]);
  else if ((m = /^(\d+)$/.exec(s))) minutes = Number(m[1]);
  if (minutes === null || !Number.isFinite(minutes)) return null;
  minutes = Math.round(minutes);
  return minutes >= 1 && minutes <= 1440 ? minutes : null;
}
