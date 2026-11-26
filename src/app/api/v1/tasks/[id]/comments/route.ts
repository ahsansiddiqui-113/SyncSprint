import { readJson, withApi } from "@/server/api-route";
import { apiAddComment, apiListComments } from "@/server/api-v1";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return withApi(req, {}, (ctx) => apiListComments(ctx, id));
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return withApi(req, { write: true }, async (ctx) => apiAddComment(ctx, id, await readJson(req)));
}
