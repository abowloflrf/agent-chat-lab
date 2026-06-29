import { describe, it, expect } from "vitest";
import { buildFontOverrideCss } from "@/lib/fonts";

describe("buildFontOverrideCss", () => {
  it("returns empty string when nothing is configured", () => {
    expect(buildFontOverrideCss("", "")).toBe("");
  });

  it("prepends a sans font onto the fallback stack, quoted", () => {
    expect(buildFontOverrideCss("PingFang SC", "")).toBe(
      ':root{--font-sans-stack:"PingFang SC",var(--font-sans-fallback);}',
    );
  });

  it("supports multiple comma-separated names (quotes optional)", () => {
    expect(buildFontOverrideCss("Inter, PingFang SC", '"JetBrains Mono"')).toBe(
      ':root{--font-sans-stack:"Inter","PingFang SC",var(--font-sans-fallback);' +
        '--font-mono-stack:"JetBrains Mono",var(--font-mono-fallback);}',
    );
  });

  it("drops CSS-injection attempts (sanitized to empty → no declaration)", () => {
    expect(buildFontOverrideCss("a;}body{display:none}", "{evil}")).toBe("");
  });
});
