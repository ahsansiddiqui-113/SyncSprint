import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireOrgPermission } from "@/lib/rbac";
import type { ClientMessage, ServerMessage } from "@/lib/realtime-protocol";
import { hub } from "./realtime-hub";

const clientMessage = z.object({
  type: z.literal("PRESENCE"),
  projectId: z.string().uuid().nullable(),
  activeTaskId: z.string().uuid().nullable(),
  editing: z.boolean(),
}) satisfies z.ZodType<ClientMessage>;

function toHeaders(req: IncomingMessage) {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") h.set(k, v);
    else if (Array.isArray(v)) h.set(k, v.join(", "));
  }
  return h;
}

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * WebSocket endpoint: `GET /ws?orgId=<uuid>`.
 * The handshake is authenticated with the same Better Auth session cookie as the
 * app, and tenant membership is verified *before* the socket joins `org:{orgId}`.
 */
export function createWsUpgradeHandler(allowedOrigins: string[]) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });

  return async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    try {
      // Cross-site WebSocket hijacking guard: cookies ride along on any origin.
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) return reject(socket, 403, "Forbidden");

      const url = new URL(req.url ?? "/", "http://localhost");
      const orgId = z.string().uuid().safeParse(url.searchParams.get("orgId"));
      if (!orgId.success) return reject(socket, 400, "Bad Request");

      const session = await auth.api.getSession({ headers: toHeaders(req) });
      if (!session) return reject(socket, 401, "Unauthorized");

      try {
        await requireOrgPermission(session.user.id, orgId.data, "viewer");
      } catch {
        return reject(socket, 403, "Forbidden");
      }

      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, orgId.data, session.user));
    } catch (err) {
      console.error("[ws] upgrade failed", err);
      reject(socket, 500, "Internal Server Error");
    }
  };
}

function onConnection(
  ws: WebSocket,
  organizationId: string,
  user: { id: string; name: string; image?: string | null }
) {
  const id = randomUUID();
  const send = (m: ServerMessage) => ws.readyState === 1 && ws.send(JSON.stringify(m));

  hub.join({
    id,
    socket: ws,
    organizationId,
    presence: { connectionId: id, userId: user.id, name: user.name, avatarUrl: user.image ?? null, projectId: null, activeTaskId: null, editing: false },
  });
  send({ type: "WELCOME", connectionId: id, userId: user.id });

  let alive = true;
  ws.on("pong", () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on("message", (raw) => {
    let parsed;
    try {
      parsed = clientMessage.safeParse(JSON.parse(String(raw)));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) return send({ type: "ERROR", code: "BAD_MESSAGE" });
    const { projectId, activeTaskId, editing } = parsed.data;
    hub.updatePresence(organizationId, id, { projectId, activeTaskId, editing });
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    hub.leave(organizationId, id);
  });
}
