import "server-only";

import { and, asc, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { db, ensureDatabase } from "@/lib/db/client";
import {
  conversations,
  messages,
  notes,
  todos,
  toolCalls,
  usageRecords,
} from "@/lib/db/schema";
import type { ChatUIMessage } from "@/lib/observability";
import { buildConversationUsageRecords } from "@/lib/usage-records";
import { toDayKey } from "@/lib/datetime";
import { DEFAULT_CONVERSATION_TITLE } from "@/lib/constants";
import { logger } from "@/lib/logger";
import type { ProviderConfig } from "@/lib/provider-config";

type NoteRecord = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
};

export type TodoStatus = "todo" | "in_progress" | "done";
export type TodoPriority = "default" | "high" | "highest";

export type TodoRecord = {
  id: string;
  title: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type ChatSnapshot = {
  conversationId: string;
  title: string | null;
  messages: ChatUIMessage[];
};

type ToolInvocation = {
  toolCallId: string;
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  messageId: string;
  position: number;
};

type ToolLikePart = ToolUIPart | DynamicToolUIPart;

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toIsoString(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function normalizeTodoPriority(value: string | null | undefined): TodoPriority {
  if (value === "highest") {
    return "highest";
  }

  if (value === "high") {
    return "high";
  }

  return "default";
}

function generateMessageId(message: ChatUIMessage): string {
  if (message.id) {
    return message.id;
  }
  
  const firstPart = message.parts[0];
  if (firstPart?.type === "text") {
    const hash = message.role + firstPart.text;
    let h = 2166136261;
    for (let i = 0; i < hash.length; i++) {
      h ^= hash.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h).toString(36).padStart(16, "0");
  }
  
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function scoreNote(note: NoteRecord, query: string) {
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

function scoreTodo(todo: TodoRecord, query: string) {
  const lowerQuery = query.toLowerCase();
  let score = 0;

  if (todo.title.toLowerCase().includes(lowerQuery)) {
    score += 4;
  }

  if (todo.content.toLowerCase().includes(lowerQuery)) {
    score += 3;
  }

  if (todo.status.includes(lowerQuery) || todo.priority.includes(lowerQuery)) {
    score += 1;
  }

  return score;
}

function isToolPart(part: UIMessage["parts"][number]): part is ToolLikePart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function extractConversationTitle(chatMessages: ChatUIMessage[]) {
  const firstUserMessage = chatMessages.find((message) => message.role === "user");
  const firstTextPart = firstUserMessage?.parts.find((part) => part.type === "text");
  const text = firstTextPart?.type === "text" ? firstTextPart.text.trim() : "";

  if (!text) {
    return DEFAULT_CONVERSATION_TITLE;
  }

  return text.slice(0, 60);
}

function extractMessageText(message: ChatUIMessage | undefined) {
  if (!message) {
    return "";
  }

  return message.parts
    .filter((part): part is Extract<ChatUIMessage["parts"][number], { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function toStoredMessage(row: typeof messages.$inferSelect): ChatUIMessage {
  const metadata = parseJson<ChatUIMessage["metadata"] | undefined>(
    row.metadataJson,
    undefined,
  );

  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    metadata: {
      ...(metadata ?? {}),
      createdAt: row.createdAt,
    },
    parts: parseJson<UIMessage["parts"]>(row.partsJson, []),
  };
}

function toStoredNote(row: typeof notes.$inferSelect): NoteRecord {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: parseJson<string[]>(row.tagsJson, []),
    createdAt: toIsoString(row.createdAt),
  };
}

function toStoredTodo(row: typeof todos.$inferSelect): TodoRecord {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status as TodoStatus,
    priority: normalizeTodoPriority(row.priority),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    completedAt: row.completedAt === null ? null : toIsoString(row.completedAt),
  };
}

function toToolInvocation(
  part: UIMessage["parts"][number],
  messageId: string,
  position: number,
): ToolInvocation | null {
  if (!isToolPart(part)) {
    return null;
  }

  if (typeof part.toolCallId !== "string") {
    return null;
  }

  const toolCallId = part.toolCallId;
  const toolName =
    part.type === "dynamic-tool"
      ? typeof part.toolName === "string"
        ? part.toolName
        : "unknown_tool"
      : part.type.replace(/^tool-/, "");

  return {
    toolCallId,
    toolName,
    state: part.state,
    input: "input" in part ? part.input : undefined,
    output: "output" in part ? part.output : undefined,
    errorText: "errorText" in part ? part.errorText : undefined,
    messageId,
    position,
  };
}

function extractToolInvocations(chatMessages: ChatUIMessage[]) {
  return chatMessages.flatMap((message) =>
    message.parts
      .map((part, index) => toToolInvocation(part, message.id, index))
      .filter((part): part is ToolInvocation => part !== null),
  );
}

function saveConversationSnapshot(
  conversationId: string,
  chatMessages: ChatUIMessage[],
  options?: { syncToolCalls?: boolean },
) {
  const now = Date.now();
  const existingConversation = db.select({
    title: conversations.title,
  }).from(conversations)
    .where(eq(conversations.id, conversationId))
    .all()[0];
  const title = existingConversation?.title?.trim() || extractConversationTitle(chatMessages);
  
  const chatMessagesWithIds = chatMessages.map((message) => ({
    ...message,
    id: message.id || generateMessageId(message),
  }));
  
  const messageIds = chatMessagesWithIds.map((message) => message.id);

  db.transaction((tx) => {
    tx.insert(conversations)
      .values({
        id: conversationId,
        title,
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
      })
      .onConflictDoUpdate({
        target: conversations.id,
        set: {
          title,
          updatedAt: now,
          lastMessageAt: now,
        },
      })
      .run();

    if (messageIds.length > 0) {
      tx.delete(messages)
        .where(and(eq(messages.conversationId, conversationId), notInArray(messages.id, messageIds)))
        .run();
    }

    chatMessagesWithIds.forEach((message, position) => {
      tx.insert(messages)
        .values({
          id: message.id,
          conversationId,
          role: message.role,
          metadataJson:
            message.metadata === undefined ? null : JSON.stringify(message.metadata),
          partsJson: JSON.stringify(message.parts),
          position,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: messages.id,
          set: {
            conversationId,
            role: message.role,
            metadataJson:
              message.metadata === undefined ? null : JSON.stringify(message.metadata),
            partsJson: JSON.stringify(message.parts),
            position,
            updatedAt: now,
          },
        })
        .run();
    });

    if (!options?.syncToolCalls) {
      return;
    }

    tx.delete(toolCalls).where(eq(toolCalls.conversationId, conversationId)).run();

    const persistedToolCalls = extractToolInvocations(chatMessages);

    if (persistedToolCalls.length > 0) {
      tx.insert(toolCalls)
        .values(
          persistedToolCalls.map((toolCall, position) => ({
            conversationId,
            messageId: toolCall.messageId,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            state: toolCall.state,
            inputJson:
              toolCall.input === undefined ? null : JSON.stringify(toolCall.input),
            outputJson:
              toolCall.output === undefined ? null : JSON.stringify(toolCall.output),
            errorText: toolCall.errorText ?? null,
            position,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .run();
    }

    tx.delete(usageRecords).where(eq(usageRecords.conversationId, conversationId)).run();

    const usageRows = buildConversationUsageRecords(conversationId, chatMessagesWithIds);

    if (usageRows.length > 0) {
      tx.insert(usageRecords).values(usageRows).run();
    }
  });
}

export type ConversationSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
};

export type ConversationQueryOptions = {
  query?: string;
  limit?: number;
  offset?: number;
};

export type ConversationQueryResult = {
  conversations: ConversationSummary[];
  hasMore: boolean;
};

export async function getAllConversations(
  options: ConversationQueryOptions = {},
): Promise<ConversationQueryResult> {
  await ensureDatabase();

  const query = options.query?.trim() ?? "";
  const limit = Math.max(1, options.limit ?? 100);
  const offset = Math.max(0, options.offset ?? 0);
  const whereClause = query
    ? sql`lower(coalesce(${conversations.title}, '')) like ${`%${query.toLocaleLowerCase()}%`}`
    : undefined;

  const rows = db.select().from(conversations)
    .where(whereClause)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit + 1)
    .offset(offset)
    .all();

  const visibleRows = rows.slice(0, limit);

  return {
    conversations: visibleRows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
      lastMessageAt: toIsoString(row.lastMessageAt),
    })),
    hasMore: rows.length > limit,
  };
}

export async function getBuiltInToolUsageCounts(): Promise<Record<string, number>> {
  await ensureDatabase();

  const rows = db
    .select({
      toolName: toolCalls.toolName,
      count: sql<number>`count(*)`,
    })
    .from(toolCalls)
    .groupBy(toolCalls.toolName)
    .all();

  return Object.fromEntries(
    rows.map((row) => [row.toolName, Number(row.count) || 0]),
  );
}

export type UsageOverview = {
  totalConversations: number;
  totalTokens: number;
  totalToolCalls: number;
  totalDurationMs: number;
  totalSteps: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export async function getUsageOverview(): Promise<UsageOverview> {
  await ensureDatabase();

  const totals = db
    .select({
      totalSteps: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${usageRecords.totalTokens}), 0)`,
      inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)`,
      cachedInputTokens: sql<number>`coalesce(sum(${usageRecords.cachedInputTokens}), 0)`,
      totalToolCalls: sql<number>`coalesce(sum(${usageRecords.toolCallCount}), 0)`,
      totalDurationMs: sql<number>`coalesce(sum(${usageRecords.durationMs}), 0)`,
    })
    .from(usageRecords)
    .all()[0];

  const conversationCount = db
    .select({ count: sql<number>`count(*)` })
    .from(conversations)
    .all()[0];

  return {
    totalConversations: Number(conversationCount?.count ?? 0),
    totalTokens: Number(totals?.totalTokens ?? 0),
    totalToolCalls: Number(totals?.totalToolCalls ?? 0),
    totalDurationMs: Number(totals?.totalDurationMs ?? 0),
    totalSteps: Number(totals?.totalSteps ?? 0),
    inputTokens: Number(totals?.inputTokens ?? 0),
    outputTokens: Number(totals?.outputTokens ?? 0),
    cachedInputTokens: Number(totals?.cachedInputTokens ?? 0),
  };
}

export type ModelUsage = {
  provider: string;
  modelId: string;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  toolCalls: number;
  avgDurationMs: number;
  totalDurationMs: number;
};

export async function getModelUsage(): Promise<ModelUsage[]> {
  await ensureDatabase();

  const rows = db
    .select({
      provider: usageRecords.provider,
      modelId: usageRecords.modelId,
      steps: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${usageRecords.totalTokens}), 0)`,
      cachedInputTokens: sql<number>`coalesce(sum(${usageRecords.cachedInputTokens}), 0)`,
      toolCalls: sql<number>`coalesce(sum(${usageRecords.toolCallCount}), 0)`,
      avgDurationMs: sql<number>`coalesce(avg(${usageRecords.durationMs}), 0)`,
      totalDurationMs: sql<number>`coalesce(sum(${usageRecords.durationMs}), 0)`,
    })
    .from(usageRecords)
    .groupBy(usageRecords.provider, usageRecords.modelId)
    .orderBy(desc(sql`sum(${usageRecords.totalTokens})`))
    .all();

  return rows.map((row) => ({
    provider: row.provider,
    modelId: row.modelId,
    steps: Number(row.steps) || 0,
    inputTokens: Number(row.inputTokens) || 0,
    outputTokens: Number(row.outputTokens) || 0,
    totalTokens: Number(row.totalTokens) || 0,
    cachedInputTokens: Number(row.cachedInputTokens) || 0,
    toolCalls: Number(row.toolCalls) || 0,
    avgDurationMs: Number(row.avgDurationMs) || 0,
    totalDurationMs: Number(row.totalDurationMs) || 0,
  }));
}

export type UsageTrendRow = {
  dayKey: number;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCalls: number;
};

export async function getUsageTrends(days: number): Promise<UsageTrendRow[]> {
  await ensureDatabase();

  const normalizedDays = Math.min(Math.max(days, 1), 365);
  const since = toDayKey(Date.now() - (normalizedDays - 1) * 86_400_000);

  const rows = db
    .select({
      dayKey: usageRecords.dayKey,
      modelId: usageRecords.modelId,
      inputTokens: sql<number>`coalesce(sum(${usageRecords.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${usageRecords.outputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${usageRecords.totalTokens}), 0)`,
      toolCalls: sql<number>`coalesce(sum(${usageRecords.toolCallCount}), 0)`,
    })
    .from(usageRecords)
    .where(gte(usageRecords.dayKey, since))
    .groupBy(usageRecords.dayKey, usageRecords.modelId)
    .orderBy(asc(usageRecords.dayKey))
    .all();

  return rows.map((row) => ({
    dayKey: Number(row.dayKey),
    modelId: row.modelId,
    inputTokens: Number(row.inputTokens) || 0,
    outputTokens: Number(row.outputTokens) || 0,
    totalTokens: Number(row.totalTokens) || 0,
    toolCalls: Number(row.toolCalls) || 0,
  }));
}

export type ConversationStat = {
  id: string;
  title: string | null;
  createdAt: string;
  lastMessageAt: string;
  userTurns: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  cacheHitRate: number | null;
  contextTokens: number | null;
  lastModelId: string | null;
  hasUsage: boolean;
};

type RawConversationStat = {
  id: string;
  title: string | null;
  created_at: number;
  last_message_at: number;
  user_turns: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
  context_tokens: number | null;
  last_model_id: string | null;
  has_usage: number;
};

export async function listConversationStats(): Promise<ConversationStat[]> {
  await ensureDatabase();

  const rows = db.all(sql`
    SELECT
      c.id AS id,
      c.title AS title,
      c.created_at AS created_at,
      c.last_message_at AS last_message_at,
      COALESCE(m.user_turns, 0) AS user_turns,
      COALESCE(u.input_tokens, 0) AS input_tokens,
      COALESCE(u.output_tokens, 0) AS output_tokens,
      COALESCE(u.cached_input_tokens, 0) AS cached_input_tokens,
      COALESCE(u.total_tokens, 0) AS total_tokens,
      u.context_tokens AS context_tokens,
      l.model_id AS last_model_id,
      CASE WHEN u.conversation_id IS NULL THEN 0 ELSE 1 END AS has_usage
    FROM conversations c
    LEFT JOIN (
      SELECT
        conversation_id,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(cached_input_tokens) AS cached_input_tokens,
        SUM(total_tokens) AS total_tokens,
        MAX(input_tokens) AS context_tokens
      FROM usage_records
      GROUP BY conversation_id
    ) u ON u.conversation_id = c.id
    LEFT JOIN (
      SELECT conversation_id, COUNT(*) AS user_turns
      FROM messages
      WHERE role = 'user'
      GROUP BY conversation_id
    ) m ON m.conversation_id = c.id
    LEFT JOIN (
      SELECT conversation_id, model_id
      FROM usage_records
      WHERE id IN (SELECT MAX(id) FROM usage_records GROUP BY conversation_id)
    ) l ON l.conversation_id = c.id
    ORDER BY c.last_message_at DESC
  `) as RawConversationStat[];

  return rows.map((row) => {
    const inputTokens = Number(row.input_tokens) || 0;
    const cachedInputTokens = Number(row.cached_input_tokens) || 0;

    return {
      id: row.id,
      title: row.title,
      createdAt: toIsoString(row.created_at),
      lastMessageAt: toIsoString(row.last_message_at),
      userTurns: Number(row.user_turns) || 0,
      inputTokens,
      outputTokens: Number(row.output_tokens) || 0,
      cachedInputTokens,
      totalTokens: Number(row.total_tokens) || 0,
      cacheHitRate: inputTokens > 0 ? cachedInputTokens / inputTokens : null,
      contextTokens: row.context_tokens === null ? null : Number(row.context_tokens),
      lastModelId: row.last_model_id,
      hasUsage: Number(row.has_usage) === 1,
    };
  });
}

export async function batchDeleteConversations(ids: string[]): Promise<number> {
  await ensureDatabase();

  if (ids.length === 0) {
    return 0;
  }

  let deleted = 0;

  db.transaction((tx) => {
    tx.delete(usageRecords).where(inArray(usageRecords.conversationId, ids)).run();
    tx.delete(toolCalls).where(inArray(toolCalls.conversationId, ids)).run();
    tx.delete(messages).where(inArray(messages.conversationId, ids)).run();
    deleted = tx.delete(conversations).where(inArray(conversations.id, ids)).run().changes;
  });

  return deleted;
}

export async function getConversation(conversationId: string): Promise<ChatSnapshot | null> {
  await ensureDatabase();

  const conversation = db.select().from(conversations)
    .where(eq(conversations.id, conversationId))
    .all()[0];

  if (!conversation) {
    return null;
  }

  const rows = db.select().from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.position), asc(messages.createdAt))
    .all();

  return {
    conversationId: conversation.id,
    title: conversation.title,
    messages: rows.map(toStoredMessage),
  };
}

export async function createConversation(title?: string): Promise<ConversationSummary> {
  await ensureDatabase();

  const now = Date.now();
  const id = crypto.randomUUID();

  db.insert(conversations)
    .values({
      id,
      title: title ?? null,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    })
    .run();

  return {
    id,
    title: title ?? null,
    createdAt: toIsoString(now),
    updatedAt: toIsoString(now),
    lastMessageAt: toIsoString(now),
  };
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await ensureDatabase();

  db.transaction((tx) => {
    tx.delete(toolCalls).where(eq(toolCalls.conversationId, conversationId)).run();
    tx.delete(messages).where(eq(messages.conversationId, conversationId)).run();
    tx.delete(conversations).where(eq(conversations.id, conversationId)).run();
  });
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<ConversationSummary> {
  await ensureDatabase();

  const now = Date.now();

  db.update(conversations)
    .set({
      title,
      updatedAt: now,
    })
    .where(eq(conversations.id, conversationId))
    .run();

  const updated = db.select().from(conversations)
    .where(eq(conversations.id, conversationId))
    .all()[0];

  if (!updated) {
    throw new Error(`Conversation ${conversationId} not found`);
  }

  return {
    id: updated.id,
    title: updated.title,
    createdAt: toIsoString(updated.createdAt),
    updatedAt: toIsoString(updated.updatedAt),
    lastMessageAt: toIsoString(updated.lastMessageAt),
  };
}

export async function generateConversationTitle(
  conversationId: string,
  chatMessages: ChatUIMessage[],
  providerConfig: ProviderConfig,
) {
  await ensureDatabase();

  const { generateText } = await import("ai");
  const { getChatModel } = await import("@/lib/ai/model");

  const model = getChatModel(providerConfig);

  const firstUserMessage = chatMessages.find((message) => message.role === "user");
  const firstAssistantMessage = chatMessages.find(
    (message) => message.role === "assistant",
  );
  const userContent = extractMessageText(firstUserMessage);
  const assistantContent = extractMessageText(firstAssistantMessage);

  if (!userContent) {
    return { success: false, title: null };
  }

  const titleLog = logger.child({ module: "TitleGen", conversationId, model: providerConfig.model });
  const startTime = Date.now();
  titleLog.info("title generation started");

  const systemMessage = "你是一个专业的会话标题生成助手。请根据首条用户消息与首条助手回复生成一个简短、清晰、可读的会话标题。只返回 JSON 格式：{\"title\": \"标题内容\"}。不要思考，不要解释，直接输出 JSON。";
  const promptMessage = `用户的第一条消息是：${userContent}

${assistantContent ? `助手的第一条回复是：${assistantContent}\n\n` : ""}请生成一个简短的会话标题，要求：
- 优先概括这轮对话已经明确的主题
- 不超过 20 个字符
- 能准确概括用户的核心意图
- 使用简洁的中文或英文
- 不要使用标点符号
- 只返回 JSON 格式，例如：{"title": "查询天气"}`;

  try {
    const { text, usage } = await generateText({
      model,
      maxOutputTokens: 100,
      providerOptions: {
        openai: { reasoningEffort: "low" },
        anthropic: { thinking: { type: "disabled" } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      system: systemMessage,
      prompt: promptMessage,
    });

    const durationMs = Date.now() - startTime;
    const tokenInfo = {
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      durationMs,
    };

    const match = text.match(/\{[^}]*"title"[^}]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.title) {
        await renameConversation(conversationId, parsed.title);
        titleLog.info({ ...tokenInfo, title: parsed.title }, "title generation succeeded");
        return { success: true, title: parsed.title };
      }
    }

    titleLog.warn({ ...tokenInfo, rawOutput: text }, "failed to parse title from model output");
    return { success: false, title: null };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    titleLog.error({ err: error, durationMs }, "title generation failed");
    return { success: false, title: null };
  }
}

export async function persistIncomingMessages(
  conversationId: string,
  chatMessages: ChatUIMessage[],
) {
  await ensureDatabase();
  saveConversationSnapshot(conversationId, chatMessages);
}

export async function persistFinishedConversation(
  conversationId: string,
  chatMessages: ChatUIMessage[],
) {
  await ensureDatabase();
  saveConversationSnapshot(conversationId, chatMessages, { syncToolCalls: true });
}

export async function createNote(input: {
  title: string;
  content: string;
  tags: string[];
}) {
  await ensureDatabase();

  const now = Date.now();
  const note = {
    id: crypto.randomUUID(),
    title: input.title,
    content: input.content,
    tags: input.tags,
    createdAt: toIsoString(now),
  } satisfies NoteRecord;

  db.insert(notes)
    .values({
      id: note.id,
      title: note.title,
      content: note.content,
      tagsJson: JSON.stringify(note.tags),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const totalNotes = db.select({ id: notes.id }).from(notes).all().length;

  return {
    success: true,
    note,
    totalNotes,
  };
}

export async function searchNotes(query: string) {
  await ensureDatabase();

  const matches = db.select().from(notes).orderBy(desc(notes.createdAt)).all()
    .map(toStoredNote)
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
}

export async function writeTodo(input: {
  action: "create" | "update" | "complete" | "reopen" | "delete";
  id?: string;
  title?: string;
  content?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
}) {
  await ensureDatabase();

  const now = Date.now();

  if (input.action === "create") {
    const todo = {
      id: crypto.randomUUID(),
      title: input.title?.trim() || "未命名待办",
      content: input.content?.trim() || "",
      status: "todo",
      priority: input.priority ?? "default",
      createdAt: toIsoString(now),
      updatedAt: toIsoString(now),
      completedAt: null,
    } satisfies TodoRecord;

    db.insert(todos)
      .values({
        id: todo.id,
        title: todo.title,
        content: todo.content,
        status: todo.status,
        priority: todo.priority,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      })
      .run();

    return {
      success: true,
      action: input.action,
      todo,
    };
  }

  if (!input.id) {
    return {
      success: false,
      action: input.action,
      error: "除 create 外，其他操作都需要提供待办 id。",
    };
  }

  const existingRow = db.select().from(todos).where(eq(todos.id, input.id)).limit(1).all()[0];

  if (!existingRow) {
    return {
      success: false,
      action: input.action,
      error: "未找到对应的待办事项。",
    };
  }

  const existingTodo = toStoredTodo(existingRow);

  if (input.action === "delete") {
    db.delete(todos).where(eq(todos.id, input.id)).run();

    return {
      success: true,
      action: input.action,
      todo: existingTodo,
    };
  }

  const nextStatus: TodoStatus =
    input.action === "complete"
      ? "done"
      : input.action === "reopen"
        ? "todo"
        : input.status ?? existingTodo.status;
  const nextCompletedAt =
    input.action === "complete"
      ? now
      : input.action === "reopen"
        ? null
        : input.status === undefined
          ? existingRow.completedAt
          : input.status === "done"
            ? existingRow.completedAt ?? now
            : null;

  db.update(todos)
    .set({
      title: input.title?.trim() || existingTodo.title,
      content:
        input.content !== undefined ? input.content.trim() : existingTodo.content,
      priority: input.priority ?? existingTodo.priority,
      status: nextStatus,
      updatedAt: now,
      completedAt: nextCompletedAt,
    })
    .where(eq(todos.id, input.id))
    .run();

  const updatedRow = db.select().from(todos).where(eq(todos.id, input.id)).limit(1).all()[0];

  return {
    success: true,
    action: input.action,
    todo: toStoredTodo(updatedRow),
  };
}

export async function readTodos(input?: {
  query?: string;
  status?: TodoStatus | "all";
  limit?: number;
}) {
  await ensureDatabase();

  const normalizedQuery = input?.query?.trim() ?? "";
  const normalizedStatus = input?.status ?? "all";
  const normalizedLimit = Math.min(Math.max(input?.limit ?? 10, 1), 200);

  const allTodos = db.select().from(todos).orderBy(desc(todos.updatedAt)).all().map(toStoredTodo);

  const filteredTodos = allTodos
    .filter((todo) => normalizedStatus === "all" || todo.status === normalizedStatus)
    .map((todo) => ({
      todo,
      score: normalizedQuery ? scoreTodo(todo, normalizedQuery) : 1,
    }))
    .filter((item) => !normalizedQuery || item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.todo.updatedAt.localeCompare(left.todo.updatedAt, "zh-CN");
    })
    .slice(0, normalizedLimit)
    .map((item) => item.todo);

  return {
    query: normalizedQuery || null,
    status: normalizedStatus,
    totalMatches: filteredTodos.length,
    todos: filteredTodos,
  };
}
