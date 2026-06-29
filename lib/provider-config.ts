import { z } from "zod";

export const DEBOUNCE_DELAY_MS = 450;

export const providerProtocols = [
  "chat-completion",
  "openai-response",
  "anthropic-message",
] as const;

export type ProviderProtocol = (typeof providerProtocols)[number];

export const providerProtocolLabels: Record<ProviderProtocol, string> = {
  "chat-completion": "Chat Completion",
  "openai-response": "OpenAI Response",
  "anthropic-message": "Anthropic Message",
};

export const providerProtocolSchema = z.enum(providerProtocols).default("chat-completion");

export const providerModelSchema = z.object({
  id: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
  isEnabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

export const providerModelInputSchema = z.object({
  id: z.string().trim().optional(),
  modelId: z.string().trim().optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const providerSettingsSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).default("OpenAI Compatible"),
  baseUrl: z.string().trim().default("https://api.openai.com/v1"),
  apiKey: z.string().trim().default(""),
  protocol: providerProtocolSchema,
  isEnabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  models: z.array(providerModelSchema).default([]),
});

export const providerSettingsInputSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  protocol: z.enum(providerProtocols).optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  models: z.array(providerModelInputSchema).optional(),
});

export const mcpHeaderSchema = z.object({
  key: z.string().trim().min(1).max(80),
  value: z.string().trim().max(2000).default(""),
});

export const mcpHeaderInputSchema = z.object({
  key: z.string().trim().optional(),
  value: z.string().trim().optional(),
});

export const mcpAuthTypes = ["header", "oauth"] as const;
export type McpAuthType = (typeof mcpAuthTypes)[number];

export const mcpServerSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).default("MCP Server"),
  url: z.string().trim().url(),
  // "header": static request headers (default, backward compatible).
  // "oauth": OAuth 2.1 authorization code flow; tokens live in mcp_oauth_sessions.
  authType: z.enum(mcpAuthTypes).default("header"),
  // Space-separated OAuth scopes; empty falls back to the server's advertised default.
  oauthScopes: z.string().trim().max(500).default(""),
  headers: z.array(mcpHeaderSchema).default([]),
  isEnabled: z.boolean().default(true),
});

export const mcpServerInputSchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().optional(),
  url: z.string().trim().optional(),
  authType: z.enum(mcpAuthTypes).optional(),
  oauthScopes: z.string().trim().optional(),
  headers: z.array(mcpHeaderInputSchema).optional(),
  isEnabled: z.boolean().optional(),
});

// 用户自定义字体值会被注入 <style>，必须防 CSS 注入。支持一个或多个 family 名、逗号分隔、
// 引号可选（如 `Inter`、`"PingFang SC"`、`"Inter","PingFang SC"`）。逐段剥用户引号后按白名单
// 校验（拉丁字母 / 数字 / 空格 / 连字符 / 下划线 / CJK），再由我们重新加引号拼回——用户的引号
// 与逗号永不原样进 CSS。非法或空段丢弃；整体超长或无合法段则归零为空。返回带引号的 CSS 列表。
const FONT_FAMILY_RE = /^[\p{Script=Han}A-Za-z0-9 _-]+$/u;
const FONT_VALUE_MAX = 200;

export function sanitizeFontStack(value: unknown): string {
  if (typeof value !== "string" || value.length > FONT_VALUE_MAX) {
    return "";
  }

  const families: string[] = [];
  for (const segment of value.split(",")) {
    let name = segment.trim();
    // Strip one matching pair of surrounding quotes the user may have typed.
    const first = name[0];
    const last = name[name.length - 1];
    if (name.length >= 2 && (first === '"' || first === "'") && last === first) {
      name = name.slice(1, -1).trim();
    }
    if (name && FONT_FAMILY_RE.test(name)) {
      families.push(JSON.stringify(name));
    }
  }

  return families.join(",");
}

const fontNameSchema = z.unknown().transform(sanitizeFontStack);

// 零散 UI 偏好的统一容器（存 systemSettings.preferences JSON 列）。今后新增偏好往这里
// 加键，无需再改数据库 schema。
export const preferencesSchema = z.object({
  fontSans: fontNameSchema,
  fontMono: fontNameSchema,
});

export const systemSettingsSchema = z.object({
  tavilyApiKey: z.string().trim().default(""),
  exaApiKey: z.string().trim().default(""),
  providers: z.array(providerSettingsSchema).default([]),
  mcpServers: z.array(mcpServerSchema).default([]),
  // 被用户在设置页关闭的 skill 名单（skill 本体在文件系统，这里只存开关状态）。
  disabledSkills: z.array(z.string().trim().min(1)).default([]),
  preferences: preferencesSchema.default({ fontSans: "", fontMono: "" }),
});

export const systemSettingsInputSchema = z.object({
  tavilyApiKey: z.string().trim().optional(),
  exaApiKey: z.string().trim().optional(),
  providers: z.array(providerSettingsInputSchema).optional(),
  mcpServers: z.array(mcpServerInputSchema).optional(),
  disabledSkills: z.array(z.string()).optional(),
  preferences: preferencesSchema.optional(),
});

export const providerConfigSchema = z.object({
  providerName: z.string().trim().default(""),
  baseUrl: z.string().trim().default("https://api.openai.com/v1"),
  apiKey: z.string().trim().default(""),
  model: z.string().trim().default(""),
  protocol: providerProtocolSchema,
  tavilyApiKey: z.string().trim().default(""),
  exaApiKey: z.string().trim().default(""),
});

export const providerConfigInputSchema = z.object({
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  model: z.string().trim().optional(),
  protocol: z.enum(providerProtocols).optional(),
  tavilyApiKey: z.string().trim().optional(),
  exaApiKey: z.string().trim().optional(),
});

export type ProviderModel = z.infer<typeof providerModelSchema>;
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;
export type McpHeader = z.infer<typeof mcpHeaderSchema>;
export type McpServer = z.infer<typeof mcpServerSchema>;
export type SystemSettings = z.infer<typeof systemSettingsSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const defaultProviderConfig: ProviderConfig = {
  providerName: "OpenAI Compatible",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
  protocol: "chat-completion",
  tavilyApiKey: "",
  exaApiKey: "",
};

export const defaultProviderSettings: ProviderSettings = {
  id: "default-provider",
  name: "OpenAI Compatible",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  protocol: "chat-completion",
  isEnabled: true,
  isDefault: true,
  models: [],
};

export const defaultSystemSettings: SystemSettings = {
  tavilyApiKey: "",
  exaApiKey: "",
  providers: [defaultProviderSettings],
  mcpServers: [],
  disabledSkills: [],
  preferences: { fontSans: "", fontMono: "" },
};

export function normalizeMcpServer(input: McpServer): McpServer {
  return {
    id: input.id.trim(),
    name: input.name.trim() || "MCP Server",
    url: input.url.trim().replace(/\/+$/, ""),
    authType: input.authType,
    oauthScopes: input.oauthScopes.trim(),
    headers: input.headers
      .map((header) => ({
        key: header.key.trim(),
        value: header.value.trim(),
      }))
      .filter((header) => header.key),
    isEnabled: input.isEnabled,
  };
}

export function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  return {
    providerName: config.providerName.trim() || defaultProviderConfig.providerName,
    baseUrl: (config.baseUrl || defaultProviderConfig.baseUrl).trim().replace(/\/+$/, ""),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    protocol: config.protocol || "chat-completion",
    tavilyApiKey: config.tavilyApiKey.trim(),
    exaApiKey: config.exaApiKey.trim(),
  };
}

function normalizeProviderModel(input: ProviderModel): ProviderModel {
  return {
    id: input.id.trim(),
    modelId: input.modelId.trim(),
    isEnabled: input.isEnabled,
    isDefault: input.isDefault,
  };
}

export function normalizeProviderSettings(input: ProviderSettings): ProviderSettings {
  const normalizedModels = input.models
    .map(normalizeProviderModel)
    .filter((model) => model.id && model.modelId);
  const enabledModels = normalizedModels.filter((model) => model.isEnabled);
  const defaultModelId = enabledModels.find((model) => model.isDefault)?.id
    ?? enabledModels[0]?.id
    ?? null;

  return {
    id: input.id.trim(),
    name: input.name.trim() || defaultProviderSettings.name,
    baseUrl: (input.baseUrl || defaultProviderSettings.baseUrl).trim().replace(/\/+$/, ""),
    apiKey: input.apiKey.trim(),
    protocol: input.protocol || "chat-completion",
    isEnabled: input.isEnabled,
    isDefault: input.isDefault,
    models: normalizedModels.map((model) => ({
      ...model,
      isDefault: defaultModelId === model.id,
    })),
  };
}

export function normalizeSystemSettings(input: SystemSettings): SystemSettings {
  const normalizedProviders = input.providers
    .map(normalizeProviderSettings)
    .filter((provider) => provider.id);
  const enabledProviders = normalizedProviders.filter((provider) => provider.isEnabled);
  const defaultProviderId = enabledProviders.find((provider) => provider.isDefault)?.id
    ?? enabledProviders[0]?.id
    ?? normalizedProviders[0]?.id
    ?? null;

  return {
    tavilyApiKey: input.tavilyApiKey.trim(),
    exaApiKey: input.exaApiKey.trim(),
    providers: normalizedProviders.map((provider) => ({
      ...provider,
      isDefault: defaultProviderId === provider.id,
    })),
    mcpServers: input.mcpServers
      .map(normalizeMcpServer)
      .filter((server) => server.id && server.url),
    disabledSkills: Array.from(
      new Set(input.disabledSkills.map((name) => name.trim()).filter(Boolean)),
    ),
    preferences: {
      fontSans: sanitizeFontStack(input.preferences?.fontSans),
      fontMono: sanitizeFontStack(input.preferences?.fontMono),
    },
  };
}
