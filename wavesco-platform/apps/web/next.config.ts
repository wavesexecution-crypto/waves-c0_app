import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@wavesco/ui", "@wavesco/db", "@wavesco/auth", "@wavesco/validators"],
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
