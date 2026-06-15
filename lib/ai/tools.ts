import { tool } from "ai";
import { z } from "zod";
import {
  askUserQuestionInputSchema,
  askUserQuestionOutputSchema,
} from "@/lib/ai/ask-user-question";
import {
  assessBashCommand,
  BASH_TOOL_MAX_COMMAND_LENGTH,
} from "@/lib/ai/bash-policy";
import { executeBashCommand } from "@/lib/ai/bash-server";
import {
  editFileForTool,
  FILE_READ_MAX_BYTES,
  FILE_READ_MAX_LINES,
  readFileForTool,
  writeFileForTool,
} from "@/lib/ai/file-tools";
import { loadSkill } from "@/lib/ai/skills";
import {
  hasAnySearchProvider,
  runWebFetch,
  runWebSearch,
  webFetchInputSchema,
  webSearchInputSchema,
} from "@/lib/ai/web-search";
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
const TODO_READ_CONTENT_PREVIEW_LENGTH = 120;

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

export function createAgentTools(
  config: ProviderConfig,
  enabledSkillNames: Set<string> = new Set(),
) {
  const tools = {
    // 客户端工具：无 execute，模型调用后流结束，由前端收集用户答案
    // 通过 addToolOutput 回填，再自动发起下一轮请求。
    AskUserQuestion: tool({
      description:
        'Ask the user one clarifying question and wait for their answer before continuing. Use it only when information essential to proceeding is missing AND no reasonable default assumption can be made. Never ask for facts you can obtain with other tools; do not ask frequently, and do not use it to confirm things you can reasonably infer. Prefer 2-4 mutually exclusive options; only mark a recommendation (first position, label suffixed with "(Recommended)") when you are reasonably confident in it — for genuinely open choices, mark none. Do not include catch-all options like "Other" — the UI provides free-form input automatically. Write the question and options in the user\'s conversation language. If the user skips, proceed with the recommended option, or make a reasonable assumption if none was marked.',
      inputSchema: askUserQuestionInputSchema,
      outputSchema: askUserQuestionOutputSchema,
    }),

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
        "管理待办事项。create 新建待办（不需要 id，应提供 title）；update 按 id 修改标题、内容、优先级或状态（如开始处理时把 status 设为 in_progress）；complete/reopen 分别等价于 update + status=done / status=todo 的快捷方式；delete 按 id 删除。除 create 外的操作都需要先通过 TodoRead 获取 id。",
      inputSchema: z.object({
        action: z
          .enum(["create", "update", "complete", "reopen", "delete"])
          .describe(
            "create 新建（无需 id）；update 修改字段含 status；complete 完成；reopen 重新打开；delete 删除。",
          ),
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
        status: z
          .enum(["todo", "in_progress", "done"])
          .optional()
          .describe(
            "待办状态，仅 action=update 时生效。用户开始处理某项时设为 in_progress。complete/reopen 会自行设置状态，无需此字段。",
          ),
        priority: z
          .enum(["default", "high", "highest"])
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
      execute: async ({ query, status, limit }) => {
        const result = await readTodos({ query, status, limit });

        return {
          ...result,
          todos: result.todos.map((todo) => {
            const truncated = todo.content.length > TODO_READ_CONTENT_PREVIEW_LENGTH;

            return {
              id: todo.id,
              title: todo.title,
              content: truncated
                ? `${todo.content.slice(0, TODO_READ_CONTENT_PREVIEW_LENGTH)}…`
                : todo.content,
              ...(truncated ? { contentTruncated: true } : {}),
              status: todo.status,
              priority: todo.priority,
              updatedAt: todo.updatedAt,
              completedAt: todo.completedAt,
            };
          }),
        };
      },
    }),

    Bash: tool({
      description:
        "Execute a non-interactive shell command and return its stdout and stderr. Pipes, redirection, and command chaining (`|`, `>`, `&&`, …) are supported. Low-risk read-only commands run automatically; commands that may modify state or use shell features require user approval; commands deemed high-risk are rejected outright. When output exceeds the limit it is truncated to keep the most recent output, and the full transcript is saved to a temp file whose path is returned (open it with the read tool).",
      inputSchema: z.object({
        command: z
          .string()
          .trim()
          .min(1)
          .max(BASH_TOOL_MAX_COMMAND_LENGTH)
          .describe(
            "The shell command to run. May use pipes, redirection, and chaining; it must be non-interactive (no commands that wait for input or open a full-screen TUI).",
          ),
        reason: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe("Optional. Explain why this command needs to run."),
      }),
      needsApproval: (input) => assessBashCommand(input.command).decision === "approval",
      execute: async ({ command }) => executeBashCommand(command),
    }),

    read: tool({
      description: `Read the contents of a text file. Output is truncated to ${FILE_READ_MAX_LINES} lines or ${FILE_READ_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
      inputSchema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Path to the file to read (relative or absolute)"),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Line number to start reading from (1-indexed)"),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Maximum number of lines to read"),
      }),
      execute: async (input) => readFileForTool(input),
    }),

    write: tool({
      description:
        "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
      inputSchema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Path to the file to write (relative or absolute)"),
        content: z.string().describe("Content to write to the file"),
      }),
      execute: async (input) => writeFileForTool(input),
    }),

    edit: tool({
      description:
        "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
      inputSchema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Path to the file to edit (relative or absolute)"),
        edits: z
          .array(
            z.object({
              oldText: z
                .string()
                .min(1)
                .describe(
                  "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
                ),
              newText: z
                .string()
                .describe("Replacement text for this targeted edit."),
            }),
          )
          .min(1)
          .describe(
            "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
          ),
      }),
      execute: async (input) => editFileForTool(input),
    }),

    WebSearch: tool({
      description:
        "Search the web for up-to-date information, news, version changes, or anything that needs external fact-checking. Backed by Tavily and/or Exa with automatic load-balancing and failover; the chosen provider is reported in the result's `provider` field.",
      inputSchema: webSearchInputSchema,
      execute: async (input) => {
        if (!hasAnySearchProvider(config)) {
          return {
            ok: false,
            error:
              "No web search provider configured. Add a Tavily or Exa API key in /settings first.",
          };
        }

        try {
          const result = await runWebSearch(input, config);
          return {
            ok: true,
            ...result,
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : "Web search failed.",
          };
        }
      },
    }),

    WebFetch: tool({
      description:
        "Fetch and extract the main content of one or more web pages. Pass several URLs at once to fetch them concurrently; use it after you already know the URLs to read page content, verify sources, compare multiple sources, or extract key points. When you need several pages, put them all in `urls` instead of calling repeatedly. Common site URLs: Hacker News (https://news.ycombinator.com), GitHub (https://github.com), Reddit (https://www.reddit.com), ProductHunt (https://www.producthunt.com) — when the user names these, build the URL and call this tool directly without searching first. Backed by Tavily and/or Exa with automatic load-balancing and failover.",
      inputSchema: webFetchInputSchema,
      execute: async (input) => {
        if (!hasAnySearchProvider(config)) {
          return {
            ok: false,
            error:
              "No web search provider configured. Add a Tavily or Exa API key in /settings first.",
          };
        }

        try {
          const result = await runWebFetch(input, config);
          return {
            ok: true,
            ...result,
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : "Web fetch failed.",
          };
        }
      },
    }),
  };

  // 没有任何启用的 skill 时不暴露 Skill 工具，避免给模型一个永远报“未找到”的入口。
  if (enabledSkillNames.size === 0) {
    return tools;
  }

  return {
    ...tools,
    Skill: tool({
      description:
        'Load a specialized skill when the user\'s task matches one of the skills listed under "Available skills" in the system prompt. This injects the skill\'s full instructions into the conversation; those instructions may describe a detailed workflow and reference scripts or files in the skill\'s directory — read them with the read tool or Bash (commands that modify state still require user approval). The name must exactly match one of the skills listed in the system prompt.',
      inputSchema: z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .describe(
            'The name of the skill to load. Must exactly match one of the skills listed under "Available skills" in the system prompt.',
          ),
      }),
      execute: async ({ name }) => {
        if (!enabledSkillNames.has(name)) {
          return {
            ok: false,
            error: `Skill "${name}" is not available or has been disabled. Only load skills listed under "Available skills" in the system prompt.`,
          };
        }

        const skill = await loadSkill(name);

        if (!skill) {
          return {
            ok: false,
            error: `Failed to load skill "${name}"; its files may have been removed.`,
          };
        }

        return {
          ok: true,
          name: skill.name,
          instructions: skill.content,
          files: skill.files,
          ...(skill.files.length > 0
            ? {
                suggestedNextAction:
                  "To use the scripts or resources in the files list, read them with the read tool or run them with Bash (commands that modify state still require user approval).",
              }
            : {}),
        };
      },
    }),
  };
}
