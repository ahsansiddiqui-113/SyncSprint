import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypt secrets we must be able to read back (chat webhook URLs, repository webhook
 * secrets) with AES-256-GCM. The key is derived from BETTER_AUTH_SECRET, so a database
 * dump alone doesn't reveal them. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
const key = () => createHash("sha256").update(`${process.env.BETTER_AUTH_SECRET || "dev-secret"}:seal:v1`).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function unseal(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unknown sealed format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

/** "https://hooks.slack.com/…/•••3fK" — enough to recognise, not enough to use. */
export const hint = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host}/…/•••${url.slice(-4)}`.slice(0, 60);
  } catch {
    return `•••${url.slice(-4)}`;
  }
};
