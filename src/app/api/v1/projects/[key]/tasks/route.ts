import { readJson, withApi } from "@/server/api-route";
import { apiCreateTask, apiListTasks } from "@/server/api-v1";

export const runtime = "nodejs";
type Params = { params: Promise<{ key: string }> };

export async function GET(req: Request, { params }: Params) {
  const { key } = await params;
  return withApi(req, {}, (ctx) => apiListTasks(ctx, key, new URL(req.url).searchParams));
}

export async function POST(req: Request, { params }: Params) {
  const { key } = await params;
  return withApi(req, { write: true }, async (ctx) => apiCreateTask(ctx, key, await readJson(req)));
}
