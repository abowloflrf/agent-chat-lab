// Pure theme data, no React. Safe to import from Server Components / route
// handlers (manifest, layout). The client hook lives in lib/theme.ts.

export const THEMES = ["warm", "paper", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "warm";

export const THEME_LABELS: Record<Theme, { name: string; description: string }> = {
  warm: { name: "暖棕奶油", description: "默认，温暖的奶油底配琥珀强调色" },
  paper: { name: "素雅黑白", description: "干净的黑白灰，无彩色强调" },
  dark: { name: "深色", description: "近黑底的通用深色模式，适合 OLED" },
};

/**
 * Browser-UI (toolbar / PWA title bar) color per theme. Drives the dynamic
 * <meta name="theme-color"> and the manifest's `theme_color`. The browser
 * chrome sits directly above the app's glass header, so this is the header's
 * effective opaque color (--glass-bg composited over --background) rather than
 * the raw page background — that keeps the toolbar visually continuous with the
 * header instead of looking like an unrendered strip.
 */
export const THEME_UI_COLORS: Record<Theme, string> = {
  warm: "#f9f7f3",
  paper: "#fbfbfb",
  dark: "#0d0d0d",
};

/**
 * Page background per theme (= --background). Drives the manifest's
 * `background_color`, i.e. the splash screen shown while an installed PWA boots.
 */
export const THEME_BACKGROUND_COLORS: Record<Theme, string> = {
  warm: "#f3efe7",
  paper: "#f6f6f6",
  dark: "#000000",
};

export const STORAGE_KEY = "color-theme";
export const EVENT = "color-theme-change";

export function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}
