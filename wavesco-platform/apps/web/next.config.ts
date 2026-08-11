import type { NextConfig } from "next";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(join(process.cwd(), "../.."), undefined, console, true);

const nextConfig: NextConfig = {
  transpilePackages: ["@wavesco/ui", "@wavesco/db", "@wavesco/auth", "@wavesco/validators"],
  eslint: {
    ignoreDuringBuilds: false,
  },
  // The Prisma client is generated into the @wavesco/db workspace package.
  // Next's serverless tracer must include its query engine binary, which is
  // resolved lazily at runtime and otherwise gets pruned from the lambda.
  outputFileTracingIncludes: {
    "/*": ["../../packages/db/src/generated/client/**/*"],
  },
};

export default nextConfig;
