"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitSignal } from "@/components/workspace/signals";
import type { ClientMessage, OrgEvent, PresenceUser, ServerMessage } from "@/lib/realtime-protocol";

export type ConnectionStatus = "connecting" | "live" | "offline" | "sync";

/**
 * "ws" (default): instant updates over the custom server's WebSocket.
 * "poll": for serverless hosts (Vercel) that can't keep WebSockets open — the board
 * re-syncs from the server every few seconds while the tab is visible.
 */
export const REALTIME_MODE = process.env.NEXT_PUBLIC_REALTIME_MODE === "poll" ? "poll" : "ws";
const POLL_MS = 5_000;

/**
 * Subscribes to the org's WebSocket room. Reconnects with capped exponential
 * backoff and calls `onResync` after a reconnect, because events published
 * while offline are not replayed (the server snapshot is the source of truth).
 */
export function useRealtime(opts: {
  organizationId: string;
  onEvent: (e: OrgEvent) => void;
  onResync: () => void;
}) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const lastPresence = useRef<ClientMessage | null>(null);
  const handlers = useRef(opts);
  handlers.current = opts;

  useEffect(() => {
    if (REALTIME_MODE !== "poll") return;
    setStatus("sync");
    const tick = () => document.visibilityState === "visible" && handlers.current.onResync();
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && handlers.current.onResync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [opts.organizationId]);

  useEffect(() => {
    if (REALTIME_MODE === "poll") return;
    let attempt = 0;
    let closedByUs = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws?orgId=${opts.organizationId}`);
      socketRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        if (attempt > 0) handlers.current.onResync();
        attempt = 0;
        setStatus("live");
        if (lastPresence.current) ws.send(JSON.stringify(lastPresence.current));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as ServerMessage;
        if (msg.type === "WELCOME") setConnectionId(msg.connectionId);
        else if (msg.type === "PRESENCE") setPresence(msg.users);
        else if (msg.type === "EVENT") {
          handlers.current.onEvent(msg.event);
          emitSignal(msg.event); // sidebar inbox, timer pill, drawer sections
        }
      };
      ws.onclose = (ev) => {
        setStatus("offline");
        setPresence([]);
        if (closedByUs || ev.code === 4403) return;
        attempt += 1;
        timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** attempt));
      };
    };
    connect();

    return () => {
      closedByUs = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, [opts.organizationId]);

  const sendPresence = useCallback((msg: Omit<ClientMessage, "type">) => {
    const full: ClientMessage = { type: "PRESENCE", ...msg };
    lastPresence.current = full;
    const ws = socketRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(full));
  }, []);

  return { status, presence, connectionId, sendPresence };
}
