import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Agent Chat Lab",
    short_name: "Agent Chat",
    description: "一个用于学习最小 Agent 构建流程的教学型 Web 应用",
    start_url: "/",
    display: "standalone",
    background_color: "#1b1712",
    theme_color: "#1b1712",
    icons: [
      { src: "/api/icon?size=192", sizes: "192x192", type: "image/png" },
      { src: "/api/icon?size=512", sizes: "512x512", type: "image/png" },
    ],
  };
}
