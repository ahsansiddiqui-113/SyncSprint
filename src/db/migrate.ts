import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import type { DB } from "./index";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Applies pending SQL migrations from ./drizzle (idempotent). */
export async function runMigrations(db: DB, url = process.env.DATABASE_URL ?? "pglite://") {
  const config = { migrationsFolder: MIGRATIONS_FOLDER };
  if (url.startsWith("pglite://")) {
    await migratePglite(db as never, config);
  } else {
    await migratePg(db as never, config);
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  (async () => {
    await import("dotenv/config");
    const { createDb, closeDb } = await import("./index");
    // Neon (via Vercel) exposes a direct URL for DDL; pooled URLs are for app traffic.
    const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "pglite://./.pglite";
    if (process.env.VERCEL && !process.env.DATABASE_URL) {
      console.error("✖ DATABASE_URL is not set for this Vercel deployment.");
      process.exit(1);
    }
    await runMigrations(createDb(url), url);
    await closeDb();
    console.log("✔ migrations applied");
    process.exit(0);
  })();
}
