import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['10.0.0.10'],
  output: 'standalone',
  // skills.ts 等从 cwd 派生路径做动态读盘，NFT 会误把运行时 volume 追踪进 standalone。
  outputFileTracingExcludes: {
    '/*': ['./workspace/**/*', './data/**/*'],
  },
};

export default nextConfig;
