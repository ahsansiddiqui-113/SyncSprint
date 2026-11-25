import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside the RSC bundler; it's a no-op in tests.
      "server-only": path.resolve(__dirname, "src/tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    // Every test file gets its own in-memory Postgres (PGlite) — no external DB needed.
    env: { DATABASE_URL: "pglite://memory", OPENROUTER_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "", GROQ_API_KEY: "" },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
