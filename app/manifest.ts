import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agent Chat Lab",
    short_name: "Agent Chat",
    description: "一个用于学习最小 Agent 构建流程的教学型 Web 应用",
    start_url: "/",
    display: "standalone",
    background_color: "#f3efe7",
    theme_color: "#f3efe7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
