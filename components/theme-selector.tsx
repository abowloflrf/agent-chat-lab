"use client";

import { THEMES, THEME_LABELS, useTheme, type Theme } from "@/lib/theme";

// Literal swatch colors for previews (mirror app/globals.css). Can't use CSS
// vars here since those reflect the *current* theme, not each option's palette.
const THEME_PREVIEW: Record<Theme, { bg: string; accent: string; fg: string }> = {
  warm: { bg: "#f3efe7", accent: "#c96a2b", fg: "#171717" },
  paper: { bg: "#f6f6f6", accent: "#0a0a0a", fg: "#6e6e6e" },
  dark: { bg: "#000000", accent: "#ededed", fg: "#8f8f8f" },
};

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <section className="max-w-2xl">
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          外观设置
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          选择界面配色。仅保存在当前浏览器（不进数据库），刷新与重开页面后保留。
        </p>
      </div>

      <div className="space-y-3">
        {THEMES.map((value) => {
          const active = theme === value;
          const preview = THEME_PREVIEW[value];
          const label = THEME_LABELS[value];
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={active}
              className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left transition ${
                active
                  ? "border-primary bg-[var(--surface-muted)]"
                  : "border-border hover:border-primary/40 hover:bg-[var(--surface-muted)]"
              }`}
            >
              {/* Palette preview: theme background with accent + foreground dots */}
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center gap-1 rounded-lg border border-border"
                style={{ background: preview.bg }}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: preview.accent }}
                />
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: preview.fg }}
                />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {label.name}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {label.description}
                </span>
              </span>

              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
              >
                {active ? (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
