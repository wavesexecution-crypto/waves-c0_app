import type { NextConfig } from "next";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(join(process.cwd(), "../.."), undefined, console, true);

const nextConfig: NextConfig = {
  transpilePackages: ["@wavesco/ui", "@wavesco/db", "@wavesco/auth", "@wavesco/validators"],
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
