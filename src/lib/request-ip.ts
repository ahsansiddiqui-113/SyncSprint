/**
 * The caller's IP for the current request, or `undefined` when there is no request
 * (scheduler, scripts, tests). `null` = a request whose address we couldn't read.
 *
 * Trust order: x-real-ip / the first x-forwarded-for hop as set by the platform proxy
 * (Vercel overwrites both). Behind your own proxy, make sure it strips client-sent values.
 */
export async function currentRequestIp(): Promise<string | null | undefined> {
  let h: Headers;
  try {
    const { headers } = await import("next/headers");
    h = await headers();
  } catch {
    return undefined; // not inside a request
  }
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || null;
}
