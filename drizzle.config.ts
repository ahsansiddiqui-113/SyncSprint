import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "pglite://./.pglite";
const isPglite = url.startsWith("pglite://");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(isPglite
    ? { driver: "pglite" as const, dbCredentials: { url: url.slice("pglite://".length) } }
    : { dbCredentials: { url } }),
  strict: true,
  verbose: true,
});
