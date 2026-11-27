import { db } from "@/db";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { broadcastOrgEvent } from "@/server/realtime-hub";
import { publishTaskUpdate } from "@/server/after-task-change";
import { applyDevItems, DevHookError, parseGithub, parseGitlab, verifyAndLoad } from "@/server/services/devlinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Repository webhooks: /api/integrations/github/<id> (X-Hub-Signature-256) and /api/integrations/gitlab/<id> (X-Gitlab-Token). */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string; id: string }> }) {
  const { provider, id } = await ctx.params;
  if (provider !== "github" && provider !== "gitlab") return new Response("Not found", { status: 404 });
  const raw = await req.text();
  if (raw.length > 5_000_000) return new Response("Too large", { status: 413 });
  try {
    const connection = await verifyAndLoad(db, provider, id, req.headers, raw);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const event = req.headers.get("x-github-event") ?? "";
    if (provider === "github" && event === "ping") return Response.json({ ok: true, pong: true });
    const items = provider === "github" ? parseGithub(event, body) : parseGitlab(body);
    const r = await applyDevItems(db, connection, items);
    const actor = { id: "dev", name: provider === "github" ? "GitHub" : "GitLab" };
    for (const t of r.closed) {
      broadcastOrgEvent(connection.organizationId, { type: "TASK_UPDATED", actor, task: toTaskDTO(t), action: "moved" });
      publishTaskUpdate(connection.organizationId, t, ["status"]);
    }
    const byProject = new Map<string, string[]>();
    for (const l of r.linked) byProject.set(l.projectId, [...(byProject.get(l.projectId) ?? []), l.taskId]);
    for (const [projectId, taskIds] of byProject) broadcastOrgEvent(connection.organizationId, { type: "TASK_META_CHANGED", actor, projectId, taskIds: [...new Set(taskIds)], kind: "dev" });
    return Response.json({ ok: true, linked: r.linked.length, closed: r.closed.length });
  } catch (err) {
    if (err instanceof DevHookError) return new Response(err.message, { status: err.status });
    if (err instanceof SyntaxError) return new Response("Bad JSON", { status: 400 });
    throw err;
  }
}
