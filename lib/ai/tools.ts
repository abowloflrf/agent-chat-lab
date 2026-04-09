import { tool } from "ai";
import { z } from "zod";
import {
  assessBashCommand,
  BASH_TOOL_MAX_COMMAND_LENGTH,
} from "@/lib/ai/bash-policy";
import { executeBashCommand } from "@/lib/ai/bash-server";
import type { ProviderConfig } from "@/lib/provider-config";
import { createNote, readTodos, searchNotes, writeTodo } from "@/lib/persistence";

const expressionPattern = /^[\d+\-*/().\s]+$/;
const MAX_EXPRESSION_LENGTH = 120;
const MAX_TITLE_LENGTH = 80;
const MAX_CONTENT_LENGTH = 400;
const MAX_TAG_LENGTH = 20;
const MAX_TAGS_COUNT = 6;
const MAX_TODO_TITLE_LENGTH = 120;
const MAX_TODO_CONTENT_LENGTH = 500;
const DEFAULT_WEB_SEARCH_LIMIT = 5;
const MAX_WEB_SEARCH_LIMIT = 10;
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

const tavilySearchInputSchema = z.object({
  query: z.string().trim().min(1).max(300).describe("要搜索的网页查询词。"),
  topic: z
    .enum(["general", "news"])
    .default("general")
    .describe("查询主题。涉及新闻或最新动态时使用 news。"),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(MAX_WEB_SEARCH_LIMIT)
    .default(DEFAULT_WEB_SEARCH_LIMIT)
    .describe("返回结果数量，范围 1-10。"),
  timeRange: z
    .enum(["day", "week", "month", "year"])
    .optional()
    .describe("仅在需要较新结果时指定时间范围。"),
  includeDomains: z
    .array(z.string().trim().min(1).max(120))
    .max(8)
    .default([])
    .describe("可选，只搜索这些域名。"),
  excludeDomains: z
    .array(z.string().trim().min(1).max(120))
    .max(8)
    .default([])
    .describe("可选，排除这些域名。"),
});

type TavilySearchInput = z.infer<typeof tavilySearchInputSchema>;

const tavilyExtractInputSchema = z.object({
  url: z.string().trim().url().max(500).describe("要抓取并提取内容的网页 URL。"),
  query: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe("可选，当前关心的问题或提取重点，用于让 Tavily 返回更相关的内容片段。"),
  extractDepth: z
    .enum(["basic", "advanced"])
    .default("basic")
    .describe("提取深度。advanced 更完整，但通常更慢。"),
  format: z
    .enum(["markdown", "text"])
    .default("markdown")
    .describe("返回内容格式。"),
});

type TavilyExtractInput = z.infer<typeof tavilyExtractInputSchema>;

async function searchWithTavily(
  input: TavilySearchInput,
  tavilyApiKey: string,
) {
  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tavilyApiKey}`,
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
        images?: string[];
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
    throw new Error(payload?.error || `Tavily 请求失败 (${response.status})`);
  }

  return {
    query: payload?.query ?? input.query,
    answer: payload?.answer ?? null,
    responseTime: payload?.response_time ?? null,
    suggestedNextAction:
      "如果需要核对原文、总结网页正文或提取细节，请从 results 中选择最相关的 url 再调用 WebFetch。",
    results: (payload?.results ?? []).map((result) => ({
      title: result.title ?? "",
      url: result.url ?? "",
      content: result.content ?? "",
      score: result.score ?? null,
      publishedDate: result.published_date ?? null,
    })),
  };
}

async function extractWithTavily(
  input: TavilyExtractInput,
  tavilyApiKey: string,
) {
  const response = await fetch(TAVILY_EXTRACT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tavilyApiKey}`,
    },
    body: JSON.stringify({
      urls: [input.url],
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
          images?: string[];
          favicon?: string;
        }>;
        failed_results?: Array<{
          url?: string;
          error?: string;
        }>;
        response_time?: number;
        error?: string;
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || `Tavily Extract 请求失败 (${response.status})`);
  }

  const result = payload?.results?.[0];
  const failedResult = payload?.failed_results?.[0];

  return {
    url: result?.url ?? input.url,
    content: result?.raw_content ?? null,
    favicon: result?.favicon ?? null,
    responseTime: payload?.response_time ?? null,
    contentPreview: result?.raw_content
      ? result.raw_content.slice(0, 1200)
      : null,
    contentLength: result?.raw_content?.length ?? 0,
    failedResult: failedResult
      ? {
          url: failedResult.url ?? input.url,
          error: failedResult.error ?? "抓取失败。",
        }
      : null,
  };
}

function evaluateExpression(expression: string) {
  const normalized = expression.replace(/\s+/g, " ").trim();

  if (!normalized) {
    throw new Error("表达式不能为空。");
  }

  if (!expressionPattern.test(normalized)) {
    throw new Error("当前计算器只支持数字、小数点、空格和 + - * / ()。");
  }

  try {
    const result = Function(`"use strict"; return (${normalized});`)();

    if (typeof result !== "number" || Number.isNaN(result)) {
      throw new Error("表达式没有计算出有效数字。");
    }

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("计算器")) {
      throw error;
    }
    throw new Error(`计算失败：${error instanceof Error ? error.message : "未知错误"}`);
  }
}

export function createAgentTools(config: ProviderConfig) {
  return {
    calculator: tool({
      description: "计算基础数学表达式，仅支持 + - * / () 和小数。",
      inputSchema: z.object({
        expression: z
          .string()
          .trim()
          .min(1)
          .max(MAX_EXPRESSION_LENGTH)
          .describe("需要计算的数学表达式，例如 (18.5 + 7.2) * 3。"),
      }),
      execute: async ({ expression }) => {
        const result = evaluateExpression(expression);

        return {
          expression,
          result,
        };
      },
    }),

    create_note: tool({
      description: "创建一条笔记，适合保存用户希望后续再次检索的信息。",
      inputSchema: z.object({
        title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
        content: z.string().trim().min(1).max(MAX_CONTENT_LENGTH),
        tags: z
          .array(z.string().trim().min(1).max(MAX_TAG_LENGTH))
          .max(MAX_TAGS_COUNT)
          .default([]),
      }),
      execute: async ({ title, content, tags }) =>
        createNote({ title, content, tags }),
    }),

    search_notes: tool({
      description: "根据关键词搜索已经保存的笔记，返回最相关的结果。",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
      }),
      execute: async ({ query }) => searchNotes(query),
    }),

    TodoWrite: tool({
      description:
        "创建或更新待办事项。适合记录下一步行动、完成状态、优先级以及删除不再需要的任务。",
      inputSchema: z.object({
        action: z.enum(["create", "update", "complete", "reopen", "delete"]),
        id: z
          .string()
          .trim()
          .optional()
          .describe("待办 id。除 create 外，其余操作都需要。"),
        title: z
          .string()
          .trim()
          .max(MAX_TODO_TITLE_LENGTH)
          .optional()
          .describe("待办标题。create 时建议提供，update 时可修改。"),
        content: z
          .string()
          .trim()
          .max(MAX_TODO_CONTENT_LENGTH)
          .optional()
          .describe("待办说明或补充内容。"),
        priority: z
          .enum(["low", "medium", "high"])
          .optional()
          .describe("待办优先级。"),
      }),
      execute: async (input) => writeTodo(input),
    }),

    TodoRead: tool({
      description: "读取待办事项列表，可按关键词和状态筛选，返回最近更新的结果。",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .max(MAX_TODO_TITLE_LENGTH)
          .optional()
          .describe("可选，按标题或内容搜索待办。"),
        status: z
          .enum(["all", "todo", "in_progress", "done"])
          .default("all")
          .describe("待办状态筛选。"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("返回条数上限。"),
      }),
      execute: async ({ query, status, limit }) => readTodos({ query, status, limit }),
    }),

    Bash: tool({
      description:
        "执行一条单段、非交互式 shell 命令。此工具每次都必须先获得用户批准，且高风险命令会被直接拒绝。",
      inputSchema: z.object({
        command: z
          .string()
          .trim()
          .min(1)
          .max(BASH_TOOL_MAX_COMMAND_LENGTH)
          .describe("要执行的单条 shell 命令。只能是非交互、无管道和无重定向的单段命令。"),
        reason: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe("可选，说明为什么必须执行这条命令。"),
      }),
      needsApproval: true,
      execute: async ({ command }) => executeBashCommand(command),
      onInputAvailable: ({ input }) => {
        assessBashCommand(input.command);
      },
    }),

    WebSearch: tool({
      description:
        "使用 Tavily 进行网页搜索，适合查询最新信息、新闻动态、版本变化或需要外部事实核验的问题。",
      inputSchema: tavilySearchInputSchema,
      execute: async (input) => {
        if (!config.tavilyApiKey) {
          return {
            ok: false,
            error:
              "未配置 Tavily API Key，无法执行联网搜索。请先到 /settings 填写 Tavily API Key。",
          };
        }

        try {
          const result = await searchWithTavily(input, config.tavilyApiKey);
          return {
            ok: true,
            ...result,
          };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Tavily 搜索失败，原因未知。",
          };
        }
      },
    }),

    WebFetch: tool({
      description:
        "使用 Tavily 抓取并提取指定网页正文，适合在已经知道 URL 后读取页面内容、核对原文或提取文档要点。常见知名网站 URL：Hacker News (https://news.ycombinator.com)、GitHub (https://github.com)、Reddit (https://www.reddit.com)、ProductHunt (https://www.producthunt.com)。当用户提到这些网站名称时，直接构造对应 URL 调用本工具，无需先搜索。",
      inputSchema: tavilyExtractInputSchema,
      execute: async (input) => {
        if (!config.tavilyApiKey) {
          return {
            ok: false,
            error:
              "未配置 Tavily API Key，无法执行网页抓取。请先到 /settings 填写 Tavily API Key。",
          };
        }

        try {
          const result = await extractWithTavily(input, config.tavilyApiKey);
          return {
            ok: true,
            ...result,
            suggestedNextAction:
              result.content && result.content.length > 1200
                ? "如果只需要回答当前问题，优先基于 contentPreview 提炼；只有在必要时再引用更长正文。"
                : "可以直接基于提取结果回答用户问题。",
          };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Tavily 网页抓取失败，原因未知。",
          };
        }
      },
    }),
  };
}
