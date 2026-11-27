/**
 * IP allow-lists: one address or CIDR range per line (IPv4 or IPv6), `#` comments allowed.
 * Pure functions so they can be unit-tested and used on both sides.
 */

function v4ToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8n) | BigInt(v);
  }
  return n;
}

function v6ToBigInt(ip: string): bigint | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // Embedded IPv4 tail (::ffff:1.2.3.4)
  const lastColon = s.lastIndexOf(":");
  if (s.slice(lastColon + 1).includes(".")) {
    const v4 = v4ToBigInt(s.slice(lastColon + 1));
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

type Parsed = { v: 4 | 6; n: bigint };
export function parseIp(raw: string): Parsed | null {
  const ip = raw.trim();
  if (!ip) return null;
  const v4 = v4ToBigInt(ip);
  if (v4 !== null) return { v: 4, n: v4 };
  const v6 = v6ToBigInt(ip);
  if (v6 === null) return null;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is treated as the IPv4 address.
  if (v6 >> 32n === 0xffffn) return { v: 4, n: v6 & 0xffffffffn };
  return { v: 6, n: v6 };
}

type Range = { v: 4 | 6; base: bigint; bits: number; text: string };
function parseRange(line: string): Range | null {
  const [addr, len, ...extra] = line.split("/");
  if (extra.length || !addr) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.v === 4 ? 32 : 128;
  const bits = len === undefined ? max : /^\d{1,3}$/.test(len) ? Number(len) : NaN;
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return null;
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(max - bits);
  return { v: ip.v, base: ip.n & mask, bits, text: line };
}

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);

/** Validate an allow-list; returns the cleaned text or the first bad line. */
export function validateAllowlist(text: string): { ok: true; cleaned: string; count: number } | { ok: false; line: string } {
  const out: string[] = [];
  for (const l of lines(text)) {
    if (!parseRange(l)) return { ok: false, line: l };
    out.push(l);
  }
  return { ok: true, cleaned: out.join("\n"), count: out.length };
}

/** True when `ip` is inside any range. An empty list allows everything; an unknown address never matches. */
export function ipAllowed(ip: string | null, list: string | null | undefined): boolean {
  const ranges = lines(list ?? "").map(parseRange).filter((r): r is Range => !!r);
  if (!ranges.length) return true;
  const p = ip ? parseIp(ip) : null;
  if (!p) return false;
  return ranges.some((r) => {
    if (r.v !== p.v) return false;
    const max = r.v === 4 ? 32 : 128;
    const mask = r.bits === 0 ? 0n : ((1n << BigInt(r.bits)) - 1n) << BigInt(max - r.bits);
    return (p.n & mask) === r.base;
  });
}
