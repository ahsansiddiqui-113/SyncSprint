import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files; keep it (and the pg driver) out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
