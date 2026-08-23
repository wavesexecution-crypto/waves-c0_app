import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root so file tracing never walks above this
  // monorepo (stray manifests higher up the tree otherwise pull the
  // build into scanning the whole user profile on Windows).
  outputFileTracingRoot: path.join(import.meta.dirname, "..", ".."),
  transpilePackages: ["@wavesco/ui", "@wavesco/db", "@wavesco/auth", "@wavesco/validators"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
