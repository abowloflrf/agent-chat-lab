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
import { logger } from "@/lib/logger";

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
        'Ask the user exactly one clarifying question and wait for their answer before continuing. Use it only when information essential to proceeding is missing AND no reasonable default assumption can be made. Look things up first (e.g. with TodoRead or WebSearch) and never ask for facts you can obtain with other tools; do not ask frequently, and do not use it to confirm things you can reasonably infer — most tasks should need zero questions. Prefer 2-4 mutually exclusive options; only mark a recommendation (first position, label suffixed with "(Recommended)") when you are reasonably confident in it — for genuinely open choices, mark none. Do not include catch-all options like "Other" — the UI provides free-form input automatically. Write the question and options in the user\'s conversation language. If the user skips, proceed with the recommended option, or make a reasonable assumption if none was marked. Example — skip it: user says "帮我查下最新的 Next.js 版本" → just call WebSearch, don\'t ask. Ask it: user says "帮我把这个部署上线" but two environments exist and neither is the default → ask which one, with them as the options.',
      inputSchema: askUserQuestionInputSchema,
      outputSchema: askUserQuestionOutputSchema,
    }),

    calculator: tool({
      description:
        "Evaluate a basic arithmetic expression. Supports + - * / ( ) and decimals only.",
      inputSchema: z.object({
        expression: z
          .string()
          .trim()
          .min(1)
          .max(MAX_EXPRESSION_LENGTH)
          .describe("The arithmetic expression to evaluate, e.g. (18.5 + 7.2) * 3."),
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
      description:
        "Save a note. Use it for information worth keeping long-term so it can be retrieved later with search_notes.",
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
      description:
        "Search saved notes by keyword and return the most relevant ones. Use it to recall information previously stored with create_note.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
      }),
      execute: async ({ query }) => searchNotes(query),
    }),

    TodoWrite: tool({
      description:
        "Manage todos when the user asks to record, track, or plan tasks. action=create adds a new todo (no id needed, provide a title); update edits title/content/priority/status by id (e.g. set status to in_progress when the user starts a task); complete/reopen are shortcuts for update + status=done / status=todo; delete removes by id. Every action except create needs an id — call TodoRead first to obtain it.",
      inputSchema: z.object({
        action: z
          .enum(["create", "update", "complete", "reopen", "delete"])
          .describe(
            "create adds a new todo (no id); update edits fields including status; complete marks it done; reopen reverts it to todo; delete removes it.",
          ),
        id: z
          .string()
          .trim()
          .optional()
          .describe("Todo id. Required for every action except create."),
        title: z
          .string()
          .trim()
          .max(MAX_TODO_TITLE_LENGTH)
          .optional()
          .describe("Todo title. Recommended on create, editable on update."),
        content: z
          .string()
          .trim()
          .max(MAX_TODO_CONTENT_LENGTH)
          .optional()
          .describe("Todo description or additional details."),
        status: z
          .enum(["todo", "in_progress", "done"])
          .optional()
          .describe(
            "Todo status; only applies when action=update. Set it to in_progress when the user starts working on the task. complete/reopen set the status themselves, so this field isn't needed for them.",
          ),
        priority: z
          .enum(["default", "high", "highest"])
          .optional()
          .describe("Todo priority."),
      }),
      execute: async (input) => writeTodo(input),
    }),

    TodoRead: tool({
      description:
        "List todos, optionally filtered by keyword and status, returning the most recently updated first. Call it before update/complete/reopen/delete to get the target id.",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .max(MAX_TODO_TITLE_LENGTH)
          .optional()
          .describe("Optional. Search todos by title or content."),
        status: z
          .enum(["all", "todo", "in_progress", "done"])
          .default("all")
          .describe("Filter by todo status."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Maximum number of todos to return."),
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
        "Execute a non-interactive shell command and return its stdout and stderr. Use it for real shell commands (git, npm, python, etc.) and only when the user explicitly asks to run a local command; do not use it to read, write, edit, or search files — use the read/write/edit tools for that. Pipes, redirection, and command chaining (`|`, `>`, `&&`, …) are supported. Low-risk read-only commands run automatically; commands that may modify state or use shell features require user approval — do not assume an approved command has already run, wait for the result; commands deemed high-risk are rejected outright. After a rejection, do not retry the same command — explain why and suggest a next step. When output exceeds the limit it is truncated to keep the most recent output, and the full transcript is saved to a temp file whose path is returned (open it with the read tool).",
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
      description: `Read the contents of a text file. Prefer this over cat/sed/head/tail in Bash. Output is truncated to ${FILE_READ_MAX_LINES} lines or ${FILE_READ_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
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
        "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories. Use write only for new files or complete rewrites; for targeted changes to an existing file, use edit. To run a longer script or block of code, write it to a file first and execute it with Bash rather than passing large code as a Bash argument.",
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
        "Edit a single file using exact text replacement. Each edits[].oldText must match the original file exactly — including indentation and whitespace — and must be unique and non-overlapping; if it isn't found, or matches more than once, the edit fails, so add surrounding context to make it unique. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",
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
        "Search the web for up-to-date information, news, version changes, or anything that needs external fact-checking. Translate search keywords to English by default. Do not answer from memory for questions that clearly depend on real-time or external information — search first; if the result snippets already answer the question, you don't need to fetch the pages. Backed by Tavily and/or Exa with automatic load-balancing and failover; the chosen provider is reported in the result's `provider` field.",
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
        "Fetch and extract the main content of one or more web pages. When you already have a specific URL, call this directly instead of searching first; prefer fetching over relying on snippets when body details, steps, code, or version specifics matter. Pass several URLs at once to fetch them concurrently — put them all in `urls` instead of calling repeatedly. Use it after you know the URLs to read page content, verify sources, compare multiple sources, or extract key points. Common site URLs: Hacker News (https://news.ycombinator.com), GitHub (https://github.com), Reddit (https://www.reddit.com), ProductHunt (https://www.producthunt.com) — when the user names these, build the URL and call this tool directly without searching first. Backed by Tavily and/or Exa with automatic load-balancing and failover.",
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
          logger.warn(
            { module: "Tools", skill: name },
            "Skill tool: enabled skill could not be loaded",
          );
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
