import "dotenv/config";
import { watch } from "node:fs";
import { createServer } from "node:http";
import next from "next";
import { closeDb, db } from "@/db";
import { MIGRATIONS_FOLDER, runMigrations } from "@/db/migrate";
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

  // Graceful shutdown: stop accepting work, then close the DB (PGlite needs a final checkpoint).
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`
${signal} received — shutting down…`);
    const force = setTimeout(() => process.exit(1), 8_000);
    force.unref();
    server.close();
    void app
      .close()
      .catch(() => {})
      .then(() => closeDb())
      .finally(() => process.exit(0));
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"] as const) process.on(sig, () => shutdown(sig));

  // Dev: apply newly generated migrations without a restart. Otherwise hot-reloaded
  // schema code can query columns the database doesn't have yet.
  if (dev) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    watch(MIGRATIONS_FOLDER, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        runMigrations(db)
          .then(() => console.log("✔ database migrations up to date"))
          .catch((err) => console.error("✖ migration failed:", err instanceof Error ? err.message : err));
      }, 500);
    });
  }

  server.listen(port, () => {
    console.log(`▲ SyncSprint ready on ${appUrl} (${dev ? "dev" : "prod"}) — WebSocket at /ws`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
