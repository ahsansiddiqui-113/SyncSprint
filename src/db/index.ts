import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Driver-agnostic Drizzle handle (postgres-js in prod, PGlite for local dev + tests). */
export type DB = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

export function createDb(url: string): DB {
  if (url.startsWith("pglite://")) {
    const dir = url.slice("pglite://".length);
    const client = dir === "memory" ? new PGlite() : new PGlite(dir);
    return drizzlePglite(client, { schema }) as unknown as DB;
  }
  const client = postgres(url, { max: 10, prepare: false });
  return drizzlePostgres(client, { schema }) as unknown as DB;
}

// The custom server (server.ts) and the Next.js bundle are separate module graphs
// in the same process; pin the instance on globalThis so both share one pool.
const g = globalThis as unknown as { __syncsprintDb?: DB };

function getDb(): DB {
  return (g.__syncsprintDb ??= createDb(process.env.DATABASE_URL ?? "pglite://./.pglite"));
}

/**
 * Lazily connected: the client is only created on first use. Next.js dev spawns
 * helper processes that import this module but never query; connecting eagerly
 * there would make them contend for the embedded PGlite data directory.
 */
export const db: DB = new Proxy({} as DB, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
