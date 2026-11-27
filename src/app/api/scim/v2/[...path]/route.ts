import { db } from "@/db";
import { appBaseUrl } from "@/lib/base-url";
import * as scim from "@/server/services/scim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SCIM 2.0 endpoint: /api/scim/v2/Users[/:id], /ServiceProviderConfig. Bearer token from Settings › Security. */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/scim+json" } });

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const base = appBaseUrl();
  try {
    const org = await scim.orgForScimToken(db, req.headers.get("authorization"));
    const [resource, id, ...rest] = path;
    if (rest.length) throw new scim.ScimError(404, "Not found");
    if (resource === "ServiceProviderConfig" && req.method === "GET") return json(scim.serviceProviderConfig(base));
    if (resource !== "Users") throw new scim.ScimError(404, "Only /Users is supported");
    const body = req.method === "POST" || req.method === "PUT" || req.method === "PATCH" ? await req.json().catch(() => null) : null;
    if (!id) {
      if (req.method === "GET") {
        const u = new URL(req.url);
        return json(await scim.listUsers(db, org, { filter: u.searchParams.get("filter"), startIndex: Number(u.searchParams.get("startIndex") ?? 1), count: Number(u.searchParams.get("count") ?? 100) }, base));
      }
      if (req.method === "POST") return json(await scim.createUser(db, org, body, base), 201);
    } else {
      if (req.method === "GET") return json(await scim.getUser(db, org, id, base));
      if (req.method === "PUT") return json(await scim.updateUser(db, org, id, body, "put", base));
      if (req.method === "PATCH") return json(await scim.updateUser(db, org, id, body, "patch", base));
      if (req.method === "DELETE") {
        await scim.deleteUser(db, org, id);
        return new Response(null, { status: 204 });
      }
    }
    throw new scim.ScimError(405, "Method not allowed");
  } catch (err) {
    if (err instanceof scim.ScimError) return json(err.body(), err.status);
    console.error("[scim] failed", err);
    return json(new scim.ScimError(500, "Internal error").body(), 500);
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
