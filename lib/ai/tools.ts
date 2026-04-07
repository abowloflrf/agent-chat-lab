import { tool } from "ai";
import { z } from "zod";
import { createNote, searchNotes } from "@/lib/persistence";

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
    execute: async ({ title, content, tags }) => createNote({ title, content, tags }),
  }),

  search_notes: tool({
    description: "根据关键词搜索已经保存的笔记，返回最相关的结果。",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    }),
    execute: async ({ query }) => searchNotes(query),
  }),
};
