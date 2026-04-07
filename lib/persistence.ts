import "server-only";

import { and, asc, desc, eq, notInArray } from "drizzle-orm";
import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { z } from "zod";
import { db, ensureDatabase } from "@/lib/db/client";
import { conversations, messages, notes, toolCalls } from "@/lib/db/schema";

type NoteRecord = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
};

type ChatSnapshot = {
  conversationId: string;
  messages: UIMessage[];
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

function generateMessageId(message: UIMessage): string {
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

function isToolPart(part: UIMessage["parts"][number]): part is ToolLikePart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function extractConversationTitle(chatMessages: UIMessage[]) {
  const firstUserMessage = chatMessages.find((message) => message.role === "user");
  const firstTextPart = firstUserMessage?.parts.find((part) => part.type === "text");
  const text = firstTextPart?.type === "text" ? firstTextPart.text.trim() : "";

  if (!text) {
    return "未命名会话";
  }

  return text.slice(0, 60);
}

function toStoredMessage(row: typeof messages.$inferSelect): UIMessage {
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    metadata: parseJson<UIMessage["metadata"] | undefined>(row.metadataJson, undefined),
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

function extractToolInvocations(chatMessages: UIMessage[]) {
  return chatMessages.flatMap((message) =>
    message.parts
      .map((part, index) => toToolInvocation(part, message.id, index))
      .filter((part): part is ToolInvocation => part !== null),
  );
}

function saveConversationSnapshot(
  conversationId: string,
  chatMessages: UIMessage[],
  options?: { syncToolCalls?: boolean },
) {
  const now = Date.now();
  const title = extractConversationTitle(chatMessages);
  
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

    if (persistedToolCalls.length === 0) {
      return;
    }

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
  });
}

export type ConversationSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
};

export async function getAllConversations(): Promise<ConversationSummary[]> {
  await ensureDatabase();

  const rows = db.select().from(conversations)
    .orderBy(desc(conversations.lastMessageAt))
    .all();

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    lastMessageAt: toIsoString(row.lastMessageAt),
  }));
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
  chatMessages: UIMessage[],
  providerConfig: {
    baseUrl: string;
    apiKey: string;
    model: string;
  },
) {
  await ensureDatabase();

  const { generateText } = await import("ai");
  const { createOpenAI } = await import("@ai-sdk/openai");

  const openai = createOpenAI({
    baseURL: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
  });

  const model = openai.chat(providerConfig.model);

  const firstUserMessage = chatMessages.find((m) => m.role === "user");
  const userText = firstUserMessage?.parts.find((p) => p.type === "text");
  const userContent = userText?.type === "text" ? userText.text : "";

  if (!userContent) {
    return { success: false, title: null };
  }

  try {
    const { text } = await generateText({
      model,
      system: "你是一个专业的会话标题生成助手。请根据用户的第一个问题或请求，生成一个简短、清晰、可读的会话标题（不超过 20 个字符）。只返回 JSON 格式：{\"title\": \"标题内容\"}",
      prompt: `用户的第一条消息是：${userContent}

请生成一个简短的会话标题，要求：
- 不超过 20 个字符
- 能准确概括用户的核心意图
- 使用简洁的中文或英文
- 不要使用标点符号
- 只返回 JSON 格式，例如：{"title": "查询天气"}`,
    });

    const match = text.match(/\{[^}]*"title"[^}]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.title) {
        await renameConversation(conversationId, parsed.title);
        return { success: true, title: parsed.title };
      }
    }

    return { success: false, title: null };
  } catch (error) {
    console.error("Failed to generate conversation title:", error);
    return { success: false, title: null };
  }
}

export async function persistIncomingMessages(
  conversationId: string,
  chatMessages: UIMessage[],
) {
  await ensureDatabase();
  saveConversationSnapshot(conversationId, chatMessages);
}

export async function persistFinishedConversation(
  conversationId: string,
  chatMessages: UIMessage[],
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
