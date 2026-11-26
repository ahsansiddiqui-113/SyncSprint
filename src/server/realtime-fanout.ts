import { randomUUID } from "node:crypto";
import type { OrgEvent, TaskDTO } from "@/lib/realtime-protocol";

/**
 * Cross-instance fan-out for realtime events, so several app servers behind a load
 * balancer stay in sync. Each instance delivers its own events to its own sockets
 * immediately, and NOTIFYs the others through Postgres (`LISTEN syncsprint_events`).
 *
 * Postgres caps NOTIFY payloads at 8 KB. Task events with a long description are sent
 * without the task body plus `reload: taskId`; receivers re-read the row from the database.
 */

export const CHANNEL = "syncsprint_events";
const MAX_PAYLOAD = 7_000;

export type Transport = {
  notify(payload: string): Promise<void>;
  listen(onMessage: (payload: string) => void): Promise<void>;
};

type Wire = { i: string; o: string; e?: OrgEvent; reload?: { kind: "TASK_CREATED" | "TASK_UPDATED"; taskId: string; event: Omit<OrgEvent, "task"> } };

export function createFanout(opts: {
  transport: Transport;
  deliverLocal: (organizationId: string, event: OrgEvent) => void;
  loadTask: (taskId: string) => Promise<TaskDTO | null>;
  onError?: (err: unknown) => void;
}) {
  const instance = randomUUID();
  const onError = opts.onError ?? ((err) => console.error("[realtime] fan-out error", err));

  async function receive(payload: string) {
    try {
      const msg = JSON.parse(payload) as Wire;
      if (msg.i === instance) return; // already delivered locally
      if (msg.e) return opts.deliverLocal(msg.o, msg.e);
      if (msg.reload) {
        const task = await opts.loadTask(msg.reload.taskId);
        if (task) opts.deliverLocal(msg.o, { ...(msg.reload.event as object), task } as OrgEvent);
      }
    } catch (err) {
      onError(err);
    }
  }

  return {
    instance,
    start: () => opts.transport.listen((p) => void receive(p)),
    receive,
    /** Deliver locally now, then tell the other instances. Never throws. */
    publish(organizationId: string, event: OrgEvent) {
      opts.deliverLocal(organizationId, event);
      let payload = JSON.stringify({ i: instance, o: organizationId, e: event } satisfies Wire);
      if (payload.length > MAX_PAYLOAD) {
        if ((event.type === "TASK_CREATED" || event.type === "TASK_UPDATED") && "task" in event) {
          const { task, ...rest } = event;
          payload = JSON.stringify({ i: instance, o: organizationId, reload: { kind: event.type, taskId: task.id, event: rest } } satisfies Wire);
        } else {
          return onError(new Error(`realtime event ${event.type} too large to fan out`));
        }
      }
      opts.transport.notify(payload).catch(onError);
    },
  };
}

export type Fanout = ReturnType<typeof createFanout>;
