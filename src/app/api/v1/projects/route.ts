import { withApi } from "@/server/api-route";
import { apiListProjects } from "@/server/api-v1";

export const runtime = "nodejs";

export function GET(req: Request) {
  return withApi(req, {}, (ctx) => apiListProjects(ctx));
}
