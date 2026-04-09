import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['10.0.0.10'],
  output: 'standalone',
};

export default nextConfig;
