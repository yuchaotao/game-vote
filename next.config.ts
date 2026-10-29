import type { NextConfig } from "next";

// Serve the app under a sub-path, e.g. BASE_PATH=/game-vote for
// https://www.yuchaotao.com/game-vote. Applied at build time; empty = site root.
const basePath = process.env.BASE_PATH?.replace(/\/+$/, "") ?? "";

if (basePath && !/^\/[\w-]+(\/[\w-]+)*$/.test(basePath)) {
  throw new Error(`BASE_PATH must look like "/game-vote", got "${process.env.BASE_PATH}"`);
}

const nextConfig: NextConfig = {
  // The Docker image runs the self-contained server (.next/standalone).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  basePath: basePath || undefined,
  // Exposed to code that builds raw hrefs (plain <a> tags don't get basePath).
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
