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
};

export default nextConfig;
