import { describe, it, expect, vi, afterEach } from "vitest";
import {
  hasAnySearchProvider,
  runWebSearch,
  runWebFetch,
  webSearchInputSchema,
  webFetchInputSchema,
  WEB_FETCH_LONG_CONTENT_CHARS,
  MAX_WEB_FETCH_URLS,
  type WebSearchInput,
  type WebFetchInput,
} from "@/lib/ai/web-search";
import { defaultProviderConfig, type ProviderConfig } from "@/lib/provider-config";

// Build a minimal ProviderConfig, optionally overriding the search keys.
function makeConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { ...defaultProviderConfig, ...overrides };
}

// A fake fetch Response that exposes only what the module reads.
type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function jsonResponse(payload: unknown, init?: { ok?: boolean; status?: number }): FakeResponse {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => payload,
  };
}

// Pin Math.random so that when BOTH keys are set, selectProviders keeps the
// natural order [tavily, exa] (it only reverses when random < 0.5).
function pinProviderOrderTavilyFirst() {
  vi.spyOn(Math, "random").mockReturnValue(0.9);
}

function getFetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

const baseSearchInput: WebSearchInput = {
  query: "what is rust",
  topic: "general",
  maxResults: 5,
  includeDomains: [],
  excludeDomains: [],
};

const baseFetchInput: WebFetchInput = {
  urls: ["https://example.com/a"],
  extractDepth: "basic",
  format: "markdown",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hasAnySearchProvider", () => {
  it("is false when neither key is set", () => {
    expect(hasAnySearchProvider(makeConfig())).toBe(false);
  });

  it("is true when only the tavily key is set", () => {
    expect(hasAnySearchProvider(makeConfig({ tavilyApiKey: "tav" }))).toBe(true);
  });

  it("is true when only the exa key is set", () => {
    expect(hasAnySearchProvider(makeConfig({ exaApiKey: "exa" }))).toBe(true);
  });

  it("is true when both keys are set", () => {
    expect(
      hasAnySearchProvider(makeConfig({ tavilyApiKey: "tav", exaApiKey: "exa" })),
    ).toBe(true);
  });
});

describe("webSearchInputSchema", () => {
  it("applies defaults for maxResults, topic, and domain arrays", () => {
    const parsed = webSearchInputSchema.parse({ query: "hello" });
    expect(parsed.maxResults).toBe(5);
    expect(parsed.topic).toBe("general");
    expect(parsed.includeDomains).toEqual([]);
    expect(parsed.excludeDomains).toEqual([]);
    expect(parsed.timeRange).toBeUndefined();
  });

  it("trims the query and rejects an empty one", () => {
    expect(webSearchInputSchema.parse({ query: "  hi  " }).query).toBe("hi");
    expect(() => webSearchInputSchema.parse({ query: "   " })).toThrow();
  });

  it("rejects maxResults above the max of 10", () => {
    expect(() => webSearchInputSchema.parse({ query: "x", maxResults: 11 })).toThrow();
  });

  it("rejects an unknown topic value", () => {
    expect(() =>
      webSearchInputSchema.parse({ query: "x", topic: "sports" }),
    ).toThrow();
  });
});

describe("webFetchInputSchema", () => {
  it("requires at least one url", () => {
    expect(() => webFetchInputSchema.parse({ urls: [] })).toThrow();
  });

  it("applies defaults for extractDepth and format", () => {
    const parsed = webFetchInputSchema.parse({ urls: ["https://example.com"] });
    expect(parsed.extractDepth).toBe("basic");
    expect(parsed.format).toBe("markdown");
    expect(parsed.query).toBeUndefined();
  });

  it("rejects more urls than the max", () => {
    const tooMany = Array.from(
      { length: MAX_WEB_FETCH_URLS + 1 },
      (_, i) => `https://example.com/${i}`,
    );
    expect(() => webFetchInputSchema.parse({ urls: tooMany })).toThrow();
  });

  it("rejects a non-url string", () => {
    expect(() => webFetchInputSchema.parse({ urls: ["not a url"] })).toThrow();
  });
});

describe("runWebSearch — tavily", () => {
  it("normalizes the tavily payload and reports provider tavily", async () => {
    const payload = {
      query: "what is rust",
      answer: "Rust is a systems language.",
      response_time: 1.23,
      results: [
        {
          title: "Rust",
          url: "https://rust-lang.org",
          content: "A language empowering everyone.",
          score: 0.95,
          published_date: "2024-01-01",
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebSearch(baseSearchInput, makeConfig({ tavilyApiKey: "tav" }));

    expect(result.provider).toBe("tavily");
    expect(result.query).toBe("what is rust");
    expect(result.answer).toBe("Rust is a systems language.");
    expect(result.responseTime).toBe(1.23);
    expect(result.results).toEqual([
      {
        title: "Rust",
        url: "https://rust-lang.org",
        content: "A language empowering everyone.",
        score: 0.95,
        publishedDate: "2024-01-01",
      },
    ]);
    expect(result.suggestedNextAction).toContain("WebFetch");

    // Hits the Tavily search endpoint with a Bearer auth header.
    const fetchMock = getFetchMock();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tav");
  });

  it("maps the input into the snake_case tavily request body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ results: [] })));

    const input: WebSearchInput = {
      query: "ts generics",
      topic: "news",
      maxResults: 3,
      timeRange: "week",
      includeDomains: ["a.com"],
      excludeDomains: ["b.com"],
    };
    await runWebSearch(input, makeConfig({ tavilyApiKey: "tav" }));

    const fetchMock = getFetchMock();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      query: "ts generics",
      topic: "news",
      max_results: 3,
      time_range: "week",
      include_domains: ["a.com"],
      exclude_domains: ["b.com"],
      search_depth: "basic",
      include_answer: "basic",
      include_raw_content: false,
      include_images: false,
      include_favicon: false,
    });
  });

  it("uses a default error message when a not-ok tavily payload has no error field", async () => {
    // payload has no `error`, so the throw falls back to the status-coded message.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 429 })),
    );

    await expect(
      runWebSearch(baseSearchInput, makeConfig({ tavilyApiKey: "tav" })),
    ).rejects.toThrow("Tavily search failed (429).");
  });

  it("throws the status-coded default when tavily returns non-json on a not-ok response", async () => {
    // json() rejects -> payload becomes null -> error message falls back to status code.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("invalid json");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runWebSearch(baseSearchInput, makeConfig({ tavilyApiKey: "tav" })),
    ).rejects.toThrow("Tavily search failed (502).");
  });

  it("falls back to defaults when tavily omits fields", async () => {
    const payload = { results: [{ url: "https://x.test" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebSearch(baseSearchInput, makeConfig({ tavilyApiKey: "tav" }));

    // query falls back to the input query; answer/responseTime to null.
    expect(result.query).toBe("what is rust");
    expect(result.answer).toBeNull();
    expect(result.responseTime).toBeNull();
    expect(result.results).toEqual([
      { title: "", url: "https://x.test", content: "", score: null, publishedDate: null },
    ]);
  });
});

describe("runWebSearch — exa", () => {
  it("normalizes the exa payload, trims text, and reports answer null", async () => {
    const payload = {
      results: [
        {
          title: "Exa Result",
          url: "https://exa.test/a",
          text: "  trimmed body  ",
          score: 0.5,
          publishedDate: "2023-05-05",
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebSearch(baseSearchInput, makeConfig({ exaApiKey: "exa" }));

    expect(result.provider).toBe("exa");
    expect(result.answer).toBeNull();
    expect(result.responseTime).toBeNull();
    expect(result.query).toBe("what is rust");
    expect(result.results).toEqual([
      {
        title: "Exa Result",
        url: "https://exa.test/a",
        content: "trimmed body",
        score: 0.5,
        publishedDate: "2023-05-05",
      },
    ]);

    // Hits the Exa search endpoint with an x-api-key header.
    const fetchMock = getFetchMock();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.exa.ai/search");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("exa");
  });

  it("omits domains/category and leaves startPublishedDate undefined for a general query without filters", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ results: [] })));

    await runWebSearch(baseSearchInput, makeConfig({ exaApiKey: "exa" }));

    const fetchMock = getFetchMock();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    // Empty domain arrays + general topic + no timeRange -> these keys are
    // undefined, so JSON.stringify drops them entirely.
    expect(body).toMatchObject({
      query: "what is rust",
      type: "auto",
      numResults: 5,
      contents: { text: { maxCharacters: 800 } },
    });
    expect(body).not.toHaveProperty("category");
    expect(body).not.toHaveProperty("includeDomains");
    expect(body).not.toHaveProperty("excludeDomains");
    expect(body).not.toHaveProperty("startPublishedDate");
  });

  it("maps news topic to category and timeRange to a startPublishedDate bound", async () => {
    // Freeze time so timeRangeToStartDate(Date.now()) is deterministic.
    const NOW = new Date("2026-06-19T00:00:00.000Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ results: [] })));

    const input: WebSearchInput = {
      query: "ai news",
      topic: "news",
      maxResults: 5,
      timeRange: "week",
      includeDomains: ["good.com"],
      excludeDomains: ["bad.com"],
    };
    await runWebSearch(input, makeConfig({ exaApiKey: "exa" }));

    const fetchMock = getFetchMock();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.category).toBe("news");
    expect(body.includeDomains).toEqual(["good.com"]);
    expect(body.excludeDomains).toEqual(["bad.com"]);
    // "week" -> 7 days before the frozen now.
    expect(body.startPublishedDate).toBe(
      new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString(),
    );

    vi.useRealTimers();
  });
});

describe("runWebSearch — fallback & failure", () => {
  it("falls back to exa when tavily responds not ok (order pinned [tavily, exa])", async () => {
    pinProviderOrderTavilyFirst();
    const fetchMock = vi
      .fn()
      // First call: tavily fails with a non-ok response carrying an error message.
      .mockResolvedValueOnce(
        jsonResponse({ error: "tavily down" }, { ok: false, status: 500 }),
      )
      // Second call: exa succeeds.
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ url: "https://exa.test/x", text: "exa wins" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runWebSearch(
      baseSearchInput,
      makeConfig({ tavilyApiKey: "tav", exaApiKey: "exa" }),
    );

    expect(result.provider).toBe("exa");
    expect(result.results[0].content).toBe("exa wins");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://api.tavily.com/search");
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe("https://api.exa.ai/search");
  });

  it("falls back to exa when the tavily fetch throws", async () => {
    pinProviderOrderTavilyFirst();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ url: "https://exa.test/y", text: "recovered" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runWebSearch(
      baseSearchInput,
      makeConfig({ tavilyApiKey: "tav", exaApiKey: "exa" }),
    );

    expect(result.provider).toBe("exa");
    expect(result.results[0].content).toBe("recovered");
  });

  it("reverses provider order to [exa, tavily] when random < 0.5", async () => {
    // random < 0.5 triggers providers.reverse(), so exa is tried first.
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ url: "https://exa.test/first", text: "exa first" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runWebSearch(
      baseSearchInput,
      makeConfig({ tavilyApiKey: "tav", exaApiKey: "exa" }),
    );

    expect(result.provider).toBe("exa");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe("https://api.exa.ai/search");
  });

  it("rejects with the last error when both providers fail", async () => {
    pinProviderOrderTavilyFirst();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "tavily boom" }, { ok: false, status: 500 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: "exa boom" }, { ok: false, status: 503 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runWebSearch(baseSearchInput, makeConfig({ tavilyApiKey: "tav", exaApiKey: "exa" })),
    ).rejects.toThrow("exa boom");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects when no provider is configured (fetch never called)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runWebSearch(baseSearchInput, makeConfig())).rejects.toThrow(
      "Web search failed.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("runWebFetch — tavily", () => {
  it("normalizes results and failedResults and suggests answering directly when content is short", async () => {
    const payload = {
      response_time: 0.42,
      results: [
        {
          url: "https://example.com/a",
          raw_content: "short body",
          favicon: "https://example.com/favicon.ico",
        },
      ],
      failed_results: [{ url: "https://example.com/bad", error: "timeout" }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebFetch(baseFetchInput, makeConfig({ tavilyApiKey: "tav" }));

    expect(result.provider).toBe("tavily");
    expect(result.responseTime).toBe(0.42);
    expect(result.results).toEqual([
      {
        url: "https://example.com/a",
        content: "short body",
        favicon: "https://example.com/favicon.ico",
        contentLength: "short body".length,
      },
    ]);
    expect(result.failedResults).toEqual([
      { url: "https://example.com/bad", error: "timeout" },
    ]);
    // No content is long enough to warrant the selective-quoting hint.
    expect(result.suggestedNextAction).toBe(
      "You can answer the user's question directly from the extracted results.",
    );

    const fetchMock = getFetchMock();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.tavily.com/extract");
  });

  it("suggests selective quoting when any content is long", async () => {
    const longBody = "x".repeat(WEB_FETCH_LONG_CONTENT_CHARS + 1);
    const payload = {
      results: [{ url: "https://example.com/a", raw_content: longBody }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebFetch(baseFetchInput, makeConfig({ tavilyApiKey: "tav" }));

    // Full content is returned once — no preview copy alongside it.
    expect(result.results[0].content).toBe(longBody);
    expect(result.results[0]).not.toHaveProperty("contentPreview");
    expect(result.results[0].contentLength).toBe(longBody.length);
    expect(result.suggestedNextAction).toContain("quoting only the parts");
    // Missing failed_results defaults to an empty array.
    expect(result.failedResults).toEqual([]);
  });

  it("defaults missing url/content/favicon fields", async () => {
    const payload = { results: [{}] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebFetch(baseFetchInput, makeConfig({ tavilyApiKey: "tav" }));

    expect(result.results).toEqual([
      {
        url: "",
        content: null,
        favicon: null,
        contentLength: 0,
      },
    ]);
  });

  it("defaults a missing failed_results error message", async () => {
    const payload = {
      results: [],
      failed_results: [{ url: "https://example.com/bad" }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebFetch(baseFetchInput, makeConfig({ tavilyApiKey: "tav" }));

    expect(result.failedResults).toEqual([
      { url: "https://example.com/bad", error: "Fetch failed." },
    ]);
    // No results at all -> no long content -> "answer directly" hint.
    expect(result.suggestedNextAction).toBe(
      "You can answer the user's question directly from the extracted results.",
    );
  });
});

describe("runWebFetch — exa", () => {
  it("derives failedResults from statuses when present", async () => {
    const payload = {
      results: [{ url: "https://example.com/a", text: "exa fetched" }],
      statuses: [
        { id: "https://example.com/a", status: "success" },
        { id: "https://example.com/b", status: "error", error: { tag: "NOT_FOUND" } },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebFetch(baseFetchInput, makeConfig({ exaApiKey: "exa" }));

    expect(result.provider).toBe("exa");
    expect(result.results[0].content).toBe("exa fetched");
    // Only the non-success status becomes a failed result.
    expect(result.failedResults).toEqual([
      { url: "https://example.com/b", error: "NOT_FOUND" },
    ]);

    const fetchMock = getFetchMock();
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://api.exa.ai/contents");
  });

  it("infers failedResults from requested urls missing in results when no statuses", async () => {
    const input: WebFetchInput = {
      ...baseFetchInput,
      urls: ["https://example.com/a", "https://example.com/b"],
    };
    const payload = {
      results: [{ url: "https://example.com/a", text: "got a" }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebFetch(input, makeConfig({ exaApiKey: "exa" }));

    expect(result.results).toHaveLength(1);
    expect(result.failedResults).toEqual([
      { url: "https://example.com/b", error: "Fetch failed or no extractable content." },
    ]);
  });

  it("defaults missing status id/error.tag and ignores statuses without a status field", async () => {
    const payload = {
      results: [],
      statuses: [
        // No `status` field at all -> filtered out (status.status is falsy).
        { id: "https://example.com/a" },
        // status present but no error.tag and no id -> both default.
        { status: "error" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebFetch(baseFetchInput, makeConfig({ exaApiKey: "exa" }));

    // Only the entry with a (non-success) status survives; its id/tag default.
    expect(result.failedResults).toEqual([{ url: "", error: "Fetch failed." }]);
  });

  it("suggests selective quoting when exa content is long", async () => {
    const longBody = "y".repeat(WEB_FETCH_LONG_CONTENT_CHARS + 1);
    const payload = {
      results: [{ url: "https://example.com/a", text: longBody }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebFetch(baseFetchInput, makeConfig({ exaApiKey: "exa" }));

    expect(result.provider).toBe("exa");
    expect(result.results[0].content).toBe(longBody);
    expect(result.results[0]).not.toHaveProperty("contentPreview");
    expect(result.results[0].contentLength).toBe(longBody.length);
    // exa responseTime is always normalized to null.
    expect(result.responseTime).toBeNull();
    expect(result.suggestedNextAction).toContain("quoting only the parts");
  });

  // KNOWN GAP: fetchWithExa builds returnedUrls from result.url. When Exa returns
  // a result whose `url` is missing (normalized to "") and provides no `statuses`,
  // the requested url never matches "", so EVERY requested url is reported as
  // failed even though a result WAS returned. This pins that current behavior.
  it("reports requested urls as failed when an exa result has no url and no statuses", async () => {
    const payload = {
      // result with extractable text but no url field.
      results: [{ text: "body without a url" }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));

    const result = await runWebFetch(baseFetchInput, makeConfig({ exaApiKey: "exa" }));

    expect(result.results).toHaveLength(1);
    expect(result.results[0].content).toBe("body without a url");
    // The single requested url is still flagged failed despite the returned result.
    expect(result.failedResults).toEqual([
      { url: "https://example.com/a", error: "Fetch failed or no extractable content." },
    ]);
  });
});

describe("runWebFetch — failure", () => {
  it("rejects when no provider is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(runWebFetch(baseFetchInput, makeConfig())).rejects.toThrow(
      "Web fetch failed.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to exa when tavily extract fails (order pinned [tavily, exa])", async () => {
    pinProviderOrderTavilyFirst();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "extract failed" }, { ok: false, status: 500 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ url: "https://example.com/a", text: "exa body" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runWebFetch(
      baseFetchInput,
      makeConfig({ tavilyApiKey: "tav", exaApiKey: "exa" }),
    );

    expect(result.provider).toBe("exa");
    expect(result.results[0].content).toBe("exa body");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
