import { beforeAll, describe, expect, it } from "vitest";
import { verifications } from "@/db/schema";
import { linkTrustedProviders } from "@/server/services/account-linking";
import { testDb } from "./helpers";
import type { DB } from "@/db";

let db: DB;
const CB = "https://app.example.com/api/auth/callback/microsoft";
const soon = () => new Date(Date.now() + 10 * 60_000);

async function state(id: string, data: object, expiresAt = soon()) {
  await db.insert(verifications).values({ identifier: `auth-state:${id}`, value: JSON.stringify(data), expiresAt });
}

beforeAll(async () => {
  db = await testDb();
  await state("link-ok", { callbackURL: "/account/security", codeVerifier: "x", expiresAt: Date.now() + 6e5, link: { userId: "u1", email: "me@example.com" } });
  await state("plain-signin", { callbackURL: "/w", codeVerifier: "x", expiresAt: Date.now() + 6e5 });
  await state("link-expired", { callbackURL: "/", codeVerifier: "x", expiresAt: 0, link: { userId: "u1", email: "me@example.com" } }, new Date(Date.now() - 1000));
  await state("garbage", { link: "nope" });
});

const req = (url: string) => new Request(url);

describe("account linking trust", () => {
  it("trusts Microsoft only on the return of an owner-started Connect", async () => {
    expect(await linkTrustedProviders(req(`${CB}?code=c&state=link-ok`), db)).toEqual(["microsoft"]);
  });
  it("does not trust a plain Continue with Microsoft (no link in the state)", async () => {
    expect(await linkTrustedProviders(req(`${CB}?code=c&state=plain-signin`), db)).toEqual([]);
  });
  it("does not trust unknown, forged, expired or malformed states", async () => {
    expect(await linkTrustedProviders(req(`${CB}?code=c&state=made-up`), db)).toEqual([]);
    expect(await linkTrustedProviders(req(`${CB}?code=c`), db)).toEqual([]);
    expect(await linkTrustedProviders(req(`${CB}?code=c&state=link-expired`), db)).toEqual([]);
    expect(await linkTrustedProviders(req(`${CB}?code=c&state=garbage`), db)).toEqual([]);
    expect(await linkTrustedProviders(req(`${CB}?state=${"x".repeat(500)}`), db)).toEqual([]);
  });
  it("never trusts on other routes or providers, or without a request", async () => {
    expect(await linkTrustedProviders(req(`https://app.example.com/api/auth/callback/google?state=link-ok`), db)).toEqual([]);
    expect(await linkTrustedProviders(req(`https://app.example.com/api/auth/sign-in/social?state=link-ok`), db)).toEqual([]);
    expect(await linkTrustedProviders(undefined, db)).toEqual([]);
  });
});
