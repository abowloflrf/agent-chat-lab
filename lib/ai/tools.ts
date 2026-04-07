import { tool } from "ai";
import { z } from "zod";

type Note = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
};

const notes: Note[] = [
  {
    id: crypto.randomUUID(),
    title: "Agent 学习路线",
    content: "先学 prompt、tools、state、loop，再扩展到 memory 和 planning。",
    tags: ["agent", "learning"],
    createdAt: new Date().toISOString(),
  },
  {
    id: crypto.randomUUID(),
    title: "当前项目定位",
    content: "这是一个教学型 Agent Web 应用，目标是把最小可解释流程先跑通。",
    tags: ["project", "mvp"],
    createdAt: new Date().toISOString(),
  },
];

const expressionPattern = /^[\d+\-*/().\s]+$/;
const MAX_EXPRESSION_LENGTH = 120;
const MAX_TITLE_LENGTH = 80;
const MAX_CONTENT_LENGTH = 400;
const MAX_TAG_LENGTH = 20;
const MAX_TAGS_COUNT = 6;

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

function scoreNote(note: Note, query: string) {
  const lowerQuery = query.toLowerCase();
  let score = 0;

  if (note.title.toLowerCase().includes(lowerQuery)) {
    score += 4;
  }

  if (note.content.toLowerCase().includes(lowerQuery)) {
    score += 3;
  }

  if (note.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))) {
    score += 2;
  }

  return score;
}

export const agentTools = {
  get_current_time: tool({
    description: "读取当前系统时间，可选指定 IANA 时区，例如 Asia/Shanghai。",
    inputSchema: z.object({
      timezone: z
        .string()
        .trim()
        .optional()
        .describe("可选 IANA 时区，例如 Asia/Shanghai 或 America/New_York。"),
    }),
    execute: async ({ timezone }) => {
      const now = new Date();
      const resolvedTimeZone =
        timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

      const formatted = new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: resolvedTimeZone,
      }).format(now);

      return {
        now: now.toISOString(),
        timezone: resolvedTimeZone,
        formatted,
      };
    },
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
      tags: z.array(z.string().trim().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS_COUNT).default([]),
    }),
    execute: async ({ title, content, tags }) => {
      const note = {
        id: crypto.randomUUID(),
        title,
        content,
        tags,
        createdAt: new Date().toISOString(),
      } satisfies Note;

      notes.unshift(note);

      return {
        success: true,
        note,
        totalNotes: notes.length,
      };
    },
  }),

  search_notes: tool({
    description: "根据关键词搜索已经保存的笔记，返回最相关的结果。",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    }),
    execute: async ({ query }) => {
      const matches = notes
        .map((note) => ({
          note,
          score: scoreNote(note, query),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map((item) => item.note);

      return {
        query,
        totalMatches: matches.length,
        matches,
      };
    },
  }),
};
