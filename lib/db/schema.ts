import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    title: text("title"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    lastMessageAt: integer("last_message_at", { mode: "number" }).notNull(),
  },
  (table) => [index("conversations_last_message_idx").on(table.lastMessageAt)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    metadataJson: text("metadata_json"),
    partsJson: text("parts_json").notNull(),
    position: integer("position", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("messages_conversation_idx").on(table.conversationId, table.position),
  ],
);

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    state: text("state").notNull(),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    errorText: text("error_text"),
    position: integer("position", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("tool_calls_conversation_idx").on(table.conversationId, table.position),
    uniqueIndex("tool_calls_conversation_call_idx").on(
      table.conversationId,
      table.toolCallId,
    ),
  ],
);

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    tagsJson: text("tags_json").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [index("notes_created_at_idx").on(table.createdAt)],
);

export const todos = sqliteTable(
  "todos",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull(),
    priority: text("priority").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    completedAt: integer("completed_at", { mode: "number" }),
  },
  (table) => [
    index("todos_created_at_idx").on(table.createdAt),
    index("todos_status_updated_idx").on(table.status, table.updatedAt),
  ],
);

export const systemSettings = sqliteTable("system_settings", {
  id: integer("id", { mode: "number" }).primaryKey(),
  tavilyApiKey: text("tavily_api_key").notNull(),
  mcpServers: text("mcp_servers").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

export const modelProviders = sqliteTable(
  "model_providers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    apiKey: text("api_key").notNull(),
    protocol: text("protocol").notNull().default("chat-completion"),
    isEnabled: integer("is_enabled", { mode: "number" }).notNull(),
    isDefault: integer("is_default", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("model_providers_enabled_idx").on(table.isEnabled, table.updatedAt),
  ],
);

export const providerModels = sqliteTable(
  "provider_models",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => modelProviders.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    isEnabled: integer("is_enabled", { mode: "number" }).notNull(),
    isDefault: integer("is_default", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("provider_models_provider_idx").on(table.providerId, table.updatedAt),
    uniqueIndex("provider_models_provider_model_idx").on(
      table.providerId,
      table.modelId,
    ),
  ],
);
