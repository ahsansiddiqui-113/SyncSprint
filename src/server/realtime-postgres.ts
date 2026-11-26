import postgres from "postgres";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { toTaskDTO } from "@/lib/realtime-protocol";
import { CHANNEL, createFanout } from "./realtime-fanout";
import { hub, setFanout } from "./realtime-hub";

/**
 * Turn on cross-instance realtime with Postgres LISTEN/NOTIFY. Needs a direct
 * (unpooled) connection: transaction-mode poolers drop LISTEN registrations.
 */
export async function startPostgresFanout(url: string) {
  if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) throw new Error("REALTIME_FANOUT=postgres needs a postgres:// DATABASE_URL (or DATABASE_URL_UNPOOLED)");
  const sql = postgres(url, { max: 1, prepare: false });
  const fanout = createFanout({
    transport: {
      notify: async (payload) => {
        await sql`select pg_notify(${CHANNEL}, ${payload})`;
      },
      listen: async (onMessage) => {
        await sql.listen(CHANNEL, onMessage);
      },
    },
    deliverLocal: (o, e) => hub.publish(o, e),
    loadTask: async (id) => {
      const [t] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      return t ? toTaskDTO(t) : null;
    },
  });
  await fanout.start();
  setFanout(fanout);
  console.log(`✔ realtime fan-out via Postgres (instance ${fanout.instance.slice(0, 8)})`);
  return fanout;
}
