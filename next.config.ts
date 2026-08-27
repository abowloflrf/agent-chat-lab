import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['10.0.0.10'],
  output: 'standalone',
  // Node 24 会通过 @swc/helpers 的 module-sync 条件加载 ESM 文件，但 Next 的
  // standalone tracing 目前只追踪到 CJS 入口，因此需要显式带上完整 helper 包。
  outputFileTracingIncludes: {
    '/*': ['./node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**/*'],
  },
  // skills.ts 等从 cwd 派生路径做动态读盘，NFT 会误把运行时 volume 追踪进 standalone。
  outputFileTracingExcludes: {
    '/*': ['./workspace/**/*', './data/**/*'],
  },
};

export default nextConfig;
