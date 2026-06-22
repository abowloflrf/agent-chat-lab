import { afterEach, describe, expect, it } from "vitest";
import { resolveBaseUrl } from "@/lib/ai/mcp-oauth";

// resolveBaseUrl only reads request.headers.get(); a minimal stub avoids undici's
// handling of the forbidden "host" header and tests the logic directly.
function fakeRequest(headers: Record<string, string>): Request {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return {
    headers: { get: (key: string) => lower[key.toLowerCase()] ?? null },
  } as unknown as Request;
}

const ORIGINAL = process.env.APP_BASE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = ORIGINAL;
});

describe("resolveBaseUrl", () => {
  it("prefers APP_BASE_URL, strips trailing slashes, and ignores headers", () => {
    process.env.APP_BASE_URL = "https://chat.example.com/";
    expect(resolveBaseUrl(fakeRequest({ "x-forwarded-host": "evil.example" }))).toBe(
      "https://chat.example.com",
    );
  });

  it("derives from x-forwarded-proto + x-forwarded-host when APP_BASE_URL is unset", () => {
    delete process.env.APP_BASE_URL;
    expect(
      resolveBaseUrl(
        fakeRequest({ "x-forwarded-proto": "https", "x-forwarded-host": "h.example.com" }),
      ),
    ).toBe("https://h.example.com");
  });

  it("falls back to the Host header with a default https scheme", () => {
    delete process.env.APP_BASE_URL;
    expect(resolveBaseUrl(fakeRequest({ host: "h2.example.com" }))).toBe(
      "https://h2.example.com",
    );
  });

  it("honors a forwarded http scheme", () => {
    delete process.env.APP_BASE_URL;
    expect(
      resolveBaseUrl(fakeRequest({ "x-forwarded-proto": "http", "x-forwarded-host": "local.test" })),
    ).toBe("http://local.test");
  });
});
