import { sanitizeFontStack } from "@/lib/provider-config";

// User fonts override the app's font stacks by redefining the *-stack vars to
// "<user fonts>, <built-in fallback chain>". The fallback chain stays as a single
// :root var (--font-*-fallback in globals.css), so it's never duplicated here.
//
// sanitizeFontStack returns an injection-safe, already-quoted CSS family list
// (whitelisted + re-quoted by us), so it can be dropped into the <style> as-is.
// An unset font yields "" and emits no declaration, leaving the CSS default.
export function buildFontOverrideCss(fontSans: unknown, fontMono: unknown): string {
  const sans = sanitizeFontStack(fontSans);
  const mono = sanitizeFontStack(fontMono);

  const decls: string[] = [];
  if (sans) {
    decls.push(`--font-sans-stack:${sans},var(--font-sans-fallback);`);
  }
  if (mono) {
    decls.push(`--font-mono-stack:${mono},var(--font-mono-fallback);`);
  }

  return decls.length ? `:root{${decls.join("")}}` : "";
}

// Client-side: reflect a font change without a reload by updating the same
// <style id="user-fonts"> node the server injected. Removing it falls back to
// the CSS defaults. No-op during SSR.
export function applyUserFontStyle(fontSans: unknown, fontMono: unknown): void {
  if (typeof document === "undefined") {
    return;
  }

  const css = buildFontOverrideCss(fontSans, fontMono);
  const existing = document.getElementById("user-fonts");

  if (!css) {
    existing?.remove();
    return;
  }

  const style = existing ?? document.createElement("style");
  if (!existing) {
    style.id = "user-fonts";
    document.head.appendChild(style);
  }
  style.textContent = css;
}
