import { withApi } from "@/server/api-route";

export const runtime = "nodejs";

/** Who is this key? Useful to test a key before wiring an integration. */
export function GET(req: Request) {
  return withApi(req, {}, async (ctx) => ({ data: { keyId: ctx.keyId, organizationId: ctx.organizationId, user: { id: ctx.userId, name: ctx.userName }, scope: ctx.scope } }));
}
