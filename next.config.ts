import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files; keep it (and the pg driver) out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // Vercel can't hold WebSockets open: the client syncs on an interval there instead.
  env: {
    NEXT_PUBLIC_REALTIME_MODE: process.env.NEXT_PUBLIC_REALTIME_MODE ?? (process.env.VERCEL ? "poll" : "ws"),
  },
};

export default nextConfig;
