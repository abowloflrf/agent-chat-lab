import { useSyncExternalStore } from "react";

export const THEMES = ["warm", "paper", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "warm";

export const THEME_LABELS: Record<Theme, { name: string; description: string }> = {
  warm: { name: "暖棕奶油", description: "默认，温暖的奶油底配琥珀强调色" },
  paper: { name: "素雅黑白", description: "干净的黑白灰，无彩色强调" },
  dark: { name: "深色", description: "近黑底的通用深色模式，适合 OLED" },
};

const STORAGE_KEY = "color-theme";
const EVENT = "color-theme-change";

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

/**
 * 主题只存浏览器端（localStorage），用 useSyncExternalStore 读取，与 chat-shell 的
 * sidebar 折叠同款模式：SSR/首帧取 server snapshot（默认 warm），hydration 后同步到
 * 真实值，避免 mismatch。同页写入不触发原生 storage 事件，故用自定义事件广播；
 * storage 事件覆盖跨标签同步。
 */
function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSnapshot(): Theme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

function getServerSnapshot(): Theme {
  return DEFAULT_THEME;
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setTheme = (next: Theme) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event(EVENT));
  };
  return { theme, setTheme };
}
