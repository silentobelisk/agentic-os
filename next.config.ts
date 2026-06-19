import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone/server.js + traced
  // node_modules) so the Electron app can run the Next server as a child
  // process. Static export is impossible here — every route handler is
  // runtime:"nodejs" and reads the filesystem / spawns the `claude` CLI.
  output: "standalone",
  // Pin the file-tracing root to this project so standalone tracing doesn't
  // walk up into the user's home directory.
  outputFileTracingRoot: __dirname,
  // Never trace the electron-builder output into the standalone server — it
  // contains a full copy of the .app (which contains another standalone copy…),
  // so without this each build nests the previous app inside the new one.
  outputFileTracingExcludes: {
    "*": ["release/**", "dist/**"],
  },
};

export default nextConfig;
