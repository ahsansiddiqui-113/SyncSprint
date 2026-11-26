import { readJson, withApi } from "@/server/api-route";
import { apiDeleteTask, apiGetTask, apiUpdateTask } from "@/server/api-v1";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return withApi(req, {}, (ctx) => apiGetTask(ctx, id));
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  return withApi(req, { write: true }, async (ctx) => apiUpdateTask(ctx, id, await readJson(req)));
}

export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  return withApi(req, { write: true }, (ctx) => apiDeleteTask(ctx, id));
}
