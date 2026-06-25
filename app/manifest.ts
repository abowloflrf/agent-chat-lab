import type { MetadataRoute } from "next";

import {
  DEFAULT_THEME,
  THEME_BACKGROUND_COLORS,
  THEME_UI_COLORS,
} from "@/lib/theme-constants";

export default function manifest(): MetadataRoute.Manifest {
  // Static defaults match the default theme. The manifest is global and can't
  // read a user's localStorage theme; the runtime <meta name="theme-color">
  // (lib/theme.ts) tracks the active theme for the browser chrome instead.
  // theme_color drives the toolbar/title bar (= header chrome); background_color
  // is the boot splash (= page background).
  return {
    name: "Agent Chat Lab",
    short_name: "Agent Chat",
    description: "一个用于学习最小 Agent 构建流程的教学型 Web 应用",
    start_url: "/",
    display: "standalone",
    background_color: THEME_BACKGROUND_COLORS[DEFAULT_THEME],
    theme_color: THEME_UI_COLORS[DEFAULT_THEME],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
