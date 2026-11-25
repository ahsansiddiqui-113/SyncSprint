import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { db } from "@/db";
import { runMigrations } from "@/db/migrate";
import { createWsUpgradeHandler } from "@/server/ws-server";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${port}`;

async function main() {
  await runMigrations(db);

  const app = next({ dev, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const nextUpgrade = app.getUpgradeHandler();
  const wsUpgrade = createWsUpgradeHandler([appUrl, `http://localhost:${port}`, `http://127.0.0.1:${port}`]);

  const server = createServer((req, res) => handle(req, res));
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/ws")) return void wsUpgrade(req, socket, head);
    return nextUpgrade(req, socket, head); // Next.js HMR in dev
  });

  server.listen(port, () => {
    console.log(`▲ SyncSprint ready on ${appUrl} (${dev ? "dev" : "prod"}) — WebSocket at /ws`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
