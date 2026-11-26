import type { WebSocket } from "ws";
import {
  roomFor,
  type OrgEvent,
  type PresenceUser,
  type ServerMessage,
} from "@/lib/realtime-protocol";

type Connection = {
  id: string;
  socket: WebSocket;
  organizationId: string;
  presence: PresenceUser;
};

/**
 * In-process pub/sub for `org:{organizationId}` rooms.
 *
 * Shared through globalThis because server actions (bundled by Next) and the
 * WebSocket server (server.ts) are different module graphs in one process.
 * To scale horizontally, swap `publish` for Redis/Postgres LISTEN-NOTIFY fan-out;
 * the room contract stays identical.
 */
class RealtimeHub {
  private rooms = new Map<string, Map<string, Connection>>();

  join(conn: Connection) {
    const room = roomFor(conn.organizationId);
    if (!this.rooms.has(room)) this.rooms.set(room, new Map());
    this.rooms.get(room)!.set(conn.id, conn);
    this.broadcastPresence(conn.organizationId);
  }

  leave(organizationId: string, connectionId: string) {
    const room = this.rooms.get(roomFor(organizationId));
    if (!room) return;
    room.delete(connectionId);
    if (room.size === 0) this.rooms.delete(roomFor(organizationId));
    else this.broadcastPresence(organizationId);
  }

  updatePresence(organizationId: string, connectionId: string, patch: Partial<PresenceUser>) {
    const conn = this.rooms.get(roomFor(organizationId))?.get(connectionId);
    if (!conn) return;
    conn.presence = { ...conn.presence, ...patch };
    this.broadcastPresence(organizationId);
  }

  /** Drop live sockets of a user who lost access (role removed). */
  evictUser(organizationId: string, userId: string) {
    const room = this.rooms.get(roomFor(organizationId));
    if (!room) return;
    for (const conn of room.values()) {
      if (conn.presence.userId === userId) conn.socket.close(4403, "membership revoked");
    }
  }

  publish(organizationId: string, event: OrgEvent) {
    this.send(organizationId, { type: "EVENT", event });
  }

  connectionCount(organizationId?: string) {
    if (organizationId) return this.rooms.get(roomFor(organizationId))?.size ?? 0;
    let n = 0;
    for (const r of this.rooms.values()) n += r.size;
    return n;
  }

  private broadcastPresence(organizationId: string) {
    const room = this.rooms.get(roomFor(organizationId));
    if (!room) return;
    this.send(organizationId, { type: "PRESENCE", users: [...room.values()].map((c) => c.presence) });
  }

  private send(organizationId: string, msg: ServerMessage) {
    const room = this.rooms.get(roomFor(organizationId));
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const conn of room.values()) {
      if (conn.socket.readyState === 1 /* OPEN */) conn.socket.send(data);
    }
  }
}

const g = globalThis as unknown as { __syncsprintHub?: RealtimeHub; __syncsprintFanout?: { publish(o: string, e: OrgEvent): void } };
export const hub: RealtimeHub = (g.__syncsprintHub ??= new RealtimeHub());

/** Multi-instance deployments install a fan-out (see realtime-fanout.ts) at boot. */
export function setFanout(f: { publish(o: string, e: OrgEvent): void } | undefined) {
  g.__syncsprintFanout = f;
}

/** Called by server actions *after* the DB transaction commits. */
export function broadcastOrgEvent(organizationId: string, event: OrgEvent) {
  if (g.__syncsprintFanout) g.__syncsprintFanout.publish(organizationId, event);
  else hub.publish(organizationId, event);
}
