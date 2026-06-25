"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_THEME,
  EVENT,
  isTheme,
  STORAGE_KEY,
  THEME_UI_COLORS,
  type Theme,
} from "./theme-constants";

// Re-export the pure data so existing `@/lib/theme` consumers keep working.
export * from "./theme-constants";

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

/** Keep the browser-UI <meta name="theme-color"> in sync with the active theme. */
function applyThemeColor(theme: Theme) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", THEME_UI_COLORS[theme]);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setTheme = (next: Theme) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.dataset.theme = next;
    applyThemeColor(next);
    window.dispatchEvent(new Event(EVENT));
  };
  return { theme, setTheme };
}
