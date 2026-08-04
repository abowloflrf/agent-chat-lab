import { z } from "zod";
import type { ProviderConfig } from "@/lib/provider-config";
import { logger } from "@/lib/logger";

const searchLog = logger.child({ module: "WebSearch" });
const fetchLog = logger.child({ module: "WebFetch" });

const DEFAULT_WEB_SEARCH_LIMIT = 5;
const MAX_WEB_SEARCH_LIMIT = 10;
export const MAX_WEB_FETCH_URLS = 5;
// Above this much extracted text, nudge the model to quote selectively instead
// of restating whole passages back into the conversation.
export const WEB_FETCH_LONG_CONTENT_CHARS = 4000;

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
// Exa 搜索结果带回的正文片段长度，对齐 Tavily 的 content 摘要量级，避免一次塞入整页。
const EXA_SEARCH_SNIPPET_CHARS = 800;
// Exa /contents 全文上限：取 Exa 文档允许的最大值 10000，尽量多保留正文。
const EXA_FETCH_MAX_CHARS = 10000;

const WEB_SEARCH_NEXT_ACTION =
  "To verify a source, summarize a page, or extract details, pick the most relevant url(s) from results and pass them to WebFetch in a single call to fetch them concurrently.";

export const webSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(300).describe("The web search query."),
  topic: z
    .enum(["general", "news"])
    .default("general")
    .describe("Query topic. Use 'news' for news or latest developments."),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(MAX_WEB_SEARCH_LIMIT)
    .default(DEFAULT_WEB_SEARCH_LIMIT)
    .describe("Number of results to return, between 1 and 10."),
  timeRange: z
    .enum(["day", "week", "month", "year"])
    .optional()
    .describe("Only set this when you need recent results, to limit the time range."),
  includeDomains: z
    .array(z.string().trim().min(1).max(120))
    .max(8)
    .default([])
    .describe("Optional. Restrict the search to these domains only."),
  excludeDomains: z
    .array(z.string().trim().min(1).max(120))
    .max(8)
    .default([])
    .describe("Optional. Exclude these domains from the search."),
});

export type WebSearchInput = z.infer<typeof webSearchInputSchema>;

export const webFetchInputSchema = z.object({
  urls: z
    .array(z.string().trim().url().max(500))
    .min(1)
    .max(MAX_WEB_FETCH_URLS)
    .describe(
      `URLs to fetch and extract the main content from. Pass several at once to fetch them concurrently (up to ${MAX_WEB_FETCH_URLS}).`,
    ),
  query: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe(
      "Optional. The current question or extraction focus, used to make the returned content snippets more relevant.",
    ),
  extractDepth: z
    .enum(["basic", "advanced"])
    .default("basic")
    .describe("Extraction depth. 'advanced' is more complete but usually slower."),
  format: z
    .enum(["markdown", "text"])
    .default("markdown")
    .describe("Returned content format."),
});

export type WebFetchInput = z.infer<typeof webFetchInputSchema>;

export type SearchProviderName = "tavily" | "exa";

type NormalizedSearchResult = {
  query: string;
  answer: string | null;
  responseTime: number | null;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number | null;
    publishedDate: string | null;
  }>;
};

type NormalizedFetchResult = {
  responseTime: number | null;
  results: Array<{
    url: string;
    content: string | null;
    favicon: string | null;
    contentLength: number;
  }>;
  failedResults: Array<{ url: string; error: string }>;
};

// 把 timeRange 映射成 Exa 的发布时间下界（ISO）。Tavily 用 time_range，Exa 用 startPublishedDate。
function timeRangeToStartDate(timeRange?: WebSearchInput["timeRange"]): string | undefined {
  if (!timeRange) {
    return undefined;
  }

  const days =
    timeRange === "day" ? 1 : timeRange === "week" ? 7 : timeRange === "month" ? 30 : 365;

  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function searchWithTavily(
  input: WebSearchInput,
  apiKey: string,
): Promise<NormalizedSearchResult> {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query: input.query,
      topic: input.topic,
      max_results: input.maxResults,
      time_range: input.timeRange,
      include_domains: input.includeDomains,
      exclude_domains: input.excludeDomains,
      search_depth: "basic",
      include_answer: "basic",
      include_raw_content: false,
      include_images: false,
      include_favicon: false,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        answer?: string;
        query?: string;
        response_time?: number;
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          score?: number;
          published_date?: string;
        }>;
        error?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || `Tavily search failed (${response.status}).`);
  }

  return {
    query: payload?.query ?? input.query,
    answer: payload?.answer ?? null,
    responseTime: payload?.response_time ?? null,
    results: (payload?.results ?? []).map((result) => ({
      title: result.title ?? "",
      url: result.url ?? "",
      content: result.content ?? "",
      score: result.score ?? null,
      publishedDate: result.published_date ?? null,
    })),
  };
}

async function searchWithExa(
  input: WebSearchInput,
  apiKey: string,
): Promise<NormalizedSearchResult> {
  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: input.query,
      type: "auto",
      numResults: input.maxResults,
      category: input.topic === "news" ? "news" : undefined,
      includeDomains: input.includeDomains.length ? input.includeDomains : undefined,
      excludeDomains: input.excludeDomains.length ? input.excludeDomains : undefined,
      startPublishedDate: timeRangeToStartDate(input.timeRange),
      maxAgeHours: 24,
      contents: { text: { maxCharacters: EXA_SEARCH_SNIPPET_CHARS } },
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        results?: Array<{
          title?: string;
          url?: string;
          text?: string;
          score?: number;
          publishedDate?: string;
        }>;
        error?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || `Exa search failed (${response.status}).`);
  }

  return {
    query: input.query,
    // Exa 的 /search 不返回合成答案，统一归一化为 null。
    answer: null,
    responseTime: null,
    results: (payload?.results ?? []).map((result) => ({
      title: result.title ?? "",
      url: result.url ?? "",
      content: (result.text ?? "").trim(),
      score: result.score ?? null,
      publishedDate: result.publishedDate ?? null,
    })),
  };
}

// Deliberately no preview field alongside `content`: both would land in the
// model context, paying for the same text twice. Progressive disclosure only
// saves tokens across separate tool calls (as the Skill tool does), never
// within one result.
function toFetchResult(url: string, content: string | null, favicon: string | null) {
  return {
    url,
    content,
    favicon,
    contentLength: content?.length ?? 0,
  };
}

async function extractWithTavily(
  input: WebFetchInput,
  apiKey: string,
): Promise<NormalizedFetchResult> {
  const response = await fetch(TAVILY_EXTRACT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      urls: input.urls,
      query: input.query,
      extract_depth: input.extractDepth,
      format: input.format,
      include_images: false,
      include_favicon: true,
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        results?: Array<{
          url?: string;
          raw_content?: string;
          favicon?: string;
        }>;
        failed_results?: Array<{ url?: string; error?: string }>;
        response_time?: number;
        error?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || `Tavily Extract failed (${response.status}).`);
  }

  return {
    responseTime: payload?.response_time ?? null,
    results: (payload?.results ?? []).map((result) =>
      toFetchResult(result.url ?? "", result.raw_content ?? null, result.favicon ?? null),
    ),
    failedResults: (payload?.failed_results ?? []).map((failed) => ({
      url: failed.url ?? "",
      error: failed.error ?? "Fetch failed.",
    })),
  };
}

async function fetchWithExa(
  input: WebFetchInput,
  apiKey: string,
): Promise<NormalizedFetchResult> {
  const response = await fetch(EXA_CONTENTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      urls: input.urls,
      maxAgeHours: 24,
      text: { maxCharacters: EXA_FETCH_MAX_CHARS },
    }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        results?: Array<{
          url?: string;
          text?: string;
          favicon?: string;
        }>;
        statuses?: Array<{ id?: string; status?: string; error?: { tag?: string } }>;
        error?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || `Exa Contents failed (${response.status}).`);
  }

  const results = (payload?.results ?? []).map((result) =>
    toFetchResult(result.url ?? "", result.text ?? null, result.favicon ?? null),
  );

  // 优先用 Exa 的 statuses 标记失败项；缺失时退回「请求过但结果里没出现的 url」。
  const returnedUrls = new Set(results.map((item) => item.url));
  const failedResults = payload?.statuses
    ? payload.statuses
        .filter((status) => status.status && status.status !== "success")
        .map((status) => ({
          url: status.id ?? "",
          error: status.error?.tag ?? "Fetch failed.",
        }))
    : input.urls
        .filter((url) => !returnedUrls.has(url))
        .map((url) => ({ url, error: "Fetch failed or no extractable content." }));

  return {
    responseTime: null,
    results,
    failedResults,
  };
}

type ConfiguredProvider = { name: SearchProviderName; apiKey: string };

// 列出已配置的搜索厂商；两家都配齐时随机决定主选顺序，实现大致 50/50 的负载均衡，
// 余下的厂商作为失败回退（某家报错或额度耗尽时自动切换）。
function selectProviders(config: ProviderConfig): ConfiguredProvider[] {
  const providers: ConfiguredProvider[] = [];

  if (config.tavilyApiKey) {
    providers.push({ name: "tavily", apiKey: config.tavilyApiKey });
  }
  if (config.exaApiKey) {
    providers.push({ name: "exa", apiKey: config.exaApiKey });
  }

  if (providers.length === 2 && Math.random() < 0.5) {
    providers.reverse();
  }

  return providers;
}

export function hasAnySearchProvider(config: ProviderConfig): boolean {
  return Boolean(config.tavilyApiKey || config.exaApiKey);
}

export type WebSearchRunResult = NormalizedSearchResult & {
  provider: SearchProviderName;
  suggestedNextAction: string;
};

export async function runWebSearch(
  input: WebSearchInput,
  config: ProviderConfig,
): Promise<WebSearchRunResult> {
  const providers = selectProviders(config);
  let lastError: unknown;

  for (const [index, provider] of providers.entries()) {
    const startedAt = Date.now();
    try {
      const result =
        provider.name === "tavily"
          ? await searchWithTavily(input, provider.apiKey)
          : await searchWithExa(input, provider.apiKey);

      searchLog.info(
        {
          provider: provider.name,
          query: input.query,
          results: result.results.length,
          durationMs: Date.now() - startedAt,
        },
        "web search succeeded",
      );
      return {
        provider: provider.name,
        ...result,
        suggestedNextAction: WEB_SEARCH_NEXT_ACTION,
      };
    } catch (error) {
      lastError = error;
      const hasFallback = index < providers.length - 1;
      searchLog.warn(
        {
          provider: provider.name,
          query: input.query,
          durationMs: Date.now() - startedAt,
          willFailover: hasFallback,
          error: error instanceof Error ? error.message : String(error),
        },
        hasFallback
          ? "web search provider failed; failing over to next"
          : "web search provider failed",
      );
    }
  }

  searchLog.error(
    { query: input.query, providersTried: providers.map((provider) => provider.name) },
    "web search failed on all providers",
  );
  throw lastError instanceof Error ? lastError : new Error("Web search failed.");
}

export type WebFetchRunResult = NormalizedFetchResult & {
  provider: SearchProviderName;
  suggestedNextAction: string;
};

export async function runWebFetch(
  input: WebFetchInput,
  config: ProviderConfig,
): Promise<WebFetchRunResult> {
  const providers = selectProviders(config);
  let lastError: unknown;

  for (const [index, provider] of providers.entries()) {
    const startedAt = Date.now();
    try {
      const result =
        provider.name === "tavily"
          ? await extractWithTavily(input, provider.apiKey)
          : await fetchWithExa(input, provider.apiKey);

      const hasLongContent = result.results.some(
        (item) => item.content && item.content.length > WEB_FETCH_LONG_CONTENT_CHARS,
      );

      fetchLog.info(
        {
          provider: provider.name,
          urls: input.urls.length,
          fetched: result.results.length,
          failed: result.failedResults.length,
          durationMs: Date.now() - startedAt,
        },
        "web fetch succeeded",
      );
      return {
        provider: provider.name,
        ...result,
        suggestedNextAction: hasLongContent
          ? "Answer from the extracted content, quoting only the parts that bear on the question — do not restate long passages."
          : "You can answer the user's question directly from the extracted results.",
      };
    } catch (error) {
      lastError = error;
      const hasFallback = index < providers.length - 1;
      fetchLog.warn(
        {
          provider: provider.name,
          urls: input.urls.length,
          durationMs: Date.now() - startedAt,
          willFailover: hasFallback,
          error: error instanceof Error ? error.message : String(error),
        },
        hasFallback
          ? "web fetch provider failed; failing over to next"
          : "web fetch provider failed",
      );
    }
  }

  fetchLog.error(
    { urls: input.urls.length, providersTried: providers.map((provider) => provider.name) },
    "web fetch failed on all providers",
  );
  throw lastError instanceof Error ? lastError : new Error("Web fetch failed.");
}
