import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files; keep it (and the pg driver) out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // CSV imports (up to 2 MB of text) go through a server action.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  // Shared read-only pages: never indexed, never framed, never sent as a referrer.
  async headers() {
    return [{ source: "/s/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Frame-Options", value: "DENY" }] }];
  },
  // Vercel can't hold WebSockets open: the client syncs on an interval there instead.
  env: {
    NEXT_PUBLIC_REALTIME_MODE: process.env.NEXT_PUBLIC_REALTIME_MODE ?? (process.env.VERCEL ? "poll" : "ws"),
  },
};

export default nextConfig;
