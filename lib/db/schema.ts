import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    title: text("title"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    lastMessageAt: integer("last_message_at", { mode: "number" }).notNull(),
    // 会话级配置：记住该会话最后一次发送时使用的模型 / MCP / Skills 选择。
    // model_* 为空表示沿用全局默认模型；两个 JSON 数组列为空（NULL）表示"未收窄"
    // （默认全开），存数组（含空数组）表示精确启用集合。
    modelProviderId: text("model_provider_id"),
    modelId: text("model_id"),
    enabledMcpServerIds: text("enabled_mcp_server_ids"),
    enabledSkillNames: text("enabled_skill_names"),
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

export const usageRecords = sqliteTable(
  "usage_records",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number", { mode: "number" }).notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    finishReason: text("finish_reason").notNull(),
    inputTokens: integer("input_tokens", { mode: "number" }).notNull(),
    outputTokens: integer("output_tokens", { mode: "number" }).notNull(),
    totalTokens: integer("total_tokens", { mode: "number" }).notNull(),
    reasoningTokens: integer("reasoning_tokens", { mode: "number" }).notNull(),
    cachedInputTokens: integer("cached_input_tokens", { mode: "number" }).notNull(),
    durationMs: integer("duration_ms", { mode: "number" }).notNull(),
    toolCallCount: integer("tool_call_count", { mode: "number" }).notNull(),
    startedAt: integer("started_at", { mode: "number" }).notNull(),
    finishedAt: integer("finished_at", { mode: "number" }).notNull(),
    dayKey: integer("day_key", { mode: "number" }).notNull(),
  },
  (table) => [
    index("usage_records_day_model_idx").on(table.dayKey, table.modelId),
    index("usage_records_conversation_idx").on(table.conversationId),
    index("usage_records_model_idx").on(table.modelId),
  ],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: text("message_id"),
    toolCallId: text("tool_call_id"),
    path: text("path").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes", { mode: "number" }).notNull(),
    mtimeMs: integer("mtime_ms", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    source: text("source").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("artifacts_conversation_idx").on(table.conversationId, table.updatedAt),
    uniqueIndex("artifacts_conversation_path_idx").on(
      table.conversationId,
      table.path,
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
  exaApiKey: text("exa_api_key").notNull().default(""),
  mcpServers: text("mcp_servers").notNull().default("[]"),
  disabledSkills: text("disabled_skills").notNull().default("[]"),
  // JSON bag for loose UI preferences (fonts, …). New prefs add keys here
  // instead of new columns, so this is the last schema change for that class.
  preferences: text("preferences").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

// One row per MCP server that uses OAuth. Tokens live here (not in the settings
// JSON blob) so silent refresh writes are cheap and isolated. The row is keyed
// by the server id from systemSettings.mcpServers[].id.
export const mcpOAuthSessions = sqliteTable(
  "mcp_oauth_sessions",
  {
    serverId: text("server_id").primaryKey(),
    // Dynamic client registration result (client_id/client_secret, plus the
    // authorization_server/token_endpoint keys @ai-sdk/mcp merges in — never strip them).
    clientInfoJson: text("client_info_json"),
    // OAuthTokens (access_token / refresh_token / scope / token_type / expires_in).
    tokensJson: text("tokens_json"),
    // Absolute expiry (ms) derived from tokens.expires_in at save time, for the UI badge.
    expiresAt: integer("expires_at", { mode: "number" }),
    // Transient during an in-flight authorize (cleared on success).
    codeVerifier: text("code_verifier"),
    state: text("state"),
    // Server URL captured at authorize time; callback rejects if the server was re-addressed.
    serverUrl: text("server_url"),
    // unauthorized | pending | authorized | needs_reauth
    status: text("status").notNull().default("unauthorized"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [index("mcp_oauth_sessions_state_idx").on(table.state)],
);

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
