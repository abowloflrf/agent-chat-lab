import "server-only";

import { eq } from "drizzle-orm";
import { db, ensureDatabase } from "@/lib/db/client";
import { modelProviders, providerModels, systemSettings } from "@/lib/db/schema";
import {
  defaultProviderConfig,
  defaultProviderSettings,
  mcpServerSchema,
  normalizeProviderConfig,
  normalizeSystemSettings,
  providerConfigInputSchema,
  systemSettingsInputSchema,
  type McpServer,
  type ProviderConfig,
  type ProviderSettings,
  type SystemSettings,
} from "@/lib/provider-config";
import { getExistingSkillNames } from "@/lib/ai/skills";
import { deleteSession, deleteSessionsNotIn, readSession } from "@/lib/db/mcp-oauth";
import { invalidateMcpCache } from "@/lib/ai/mcp";

const SETTINGS_ROW_ID = 1;

const envProviderConfig: ProviderConfig = normalizeProviderConfig({
  providerName: defaultProviderSettings.name,
  baseUrl: process.env.OPENAI_BASE_URL ?? defaultProviderConfig.baseUrl,
  apiKey: process.env.OPENAI_API_KEY ?? "",
  model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  protocol: "chat-completion",
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
  exaApiKey: process.env.EXA_API_KEY ?? "",
});

function toBool(value: number) {
  return value === 1;
}

function parseMcpServersColumn(raw: string | null | undefined): McpServer[] {
  if (!raw) {
    return [];
  }

  try {
    const json: unknown = JSON.parse(raw);

    if (!Array.isArray(json)) {
      return [];
    }

    // Parse entry by entry so one corrupt record drops only itself instead of
    // silently wiping the whole server list.
    return json.flatMap((entry) => {
      const parsed = mcpServerSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

function parseDisabledSkillsColumn(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const json: unknown = JSON.parse(raw);

    if (!Array.isArray(json)) {
      return [];
    }

    return json.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function toInt(value: boolean) {
  return value ? 1 : 0;
}

function buildDefaultSettingsFromEnv(): SystemSettings {
  return normalizeSystemSettings({
    tavilyApiKey: envProviderConfig.tavilyApiKey,
    exaApiKey: envProviderConfig.exaApiKey,
    providers: [
      {
        ...defaultProviderSettings,
        id: crypto.randomUUID(),
        baseUrl: envProviderConfig.baseUrl,
        apiKey: envProviderConfig.apiKey,
        models: envProviderConfig.model
          ? [
              {
                id: crypto.randomUUID(),
                modelId: envProviderConfig.model,
                isEnabled: true,
                isDefault: true,
              },
            ]
          : [],
      },
    ],
    mcpServers: [],
    disabledSkills: [],
  });
}

function pickActiveProvider(providers: ProviderSettings[]) {
  return providers.find((provider) => provider.isEnabled && provider.isDefault)
    ?? providers.find((provider) => provider.isEnabled)
    ?? providers[0]
    ?? null;
}

function pickActiveModel(provider: ProviderSettings | null) {
  if (!provider) {
    return null;
  }

  return provider.models.find((model) => model.isEnabled && model.isDefault)
    ?? provider.models.find((model) => model.isEnabled)
    ?? provider.models[0]
    ?? null;
}

function buildProviderConfigFromSettings(
  settings: SystemSettings,
  provider: ProviderSettings,
  modelId: string,
): ProviderConfig {
  return normalizeProviderConfig({
    providerName: provider.name || envProviderConfig.providerName,
    baseUrl: provider.baseUrl || envProviderConfig.baseUrl,
    apiKey: provider.apiKey || envProviderConfig.apiKey,
    model: modelId || envProviderConfig.model,
    protocol: provider.protocol || envProviderConfig.protocol,
    tavilyApiKey: settings.tavilyApiKey || envProviderConfig.tavilyApiKey,
    exaApiKey: settings.exaApiKey || envProviderConfig.exaApiKey,
  });
}

export function getRuntimeProviderConfigFromSettings(settings: SystemSettings): ProviderConfig {
  const provider = pickActiveProvider(settings.providers);
  const model = pickActiveModel(provider);

  if (!provider || !model) {
    return envProviderConfig;
  }

  return buildProviderConfigFromSettings(settings, provider, model.modelId);
}

export function getProviderConfigByOverrideFromSettings(
  settings: SystemSettings,
  providerId: string,
  modelId: string,
): ProviderConfig {
  const provider = settings.providers.find((p) => p.id === providerId && p.isEnabled);
  const model = provider?.models.find((item) => item.modelId === modelId && item.isEnabled);

  if (!provider || !model) {
    return getRuntimeProviderConfigFromSettings(settings);
  }

  return buildProviderConfigFromSettings(settings, provider, model.modelId);
}

export function getEnabledMcpServersFromSettings(settings: SystemSettings): McpServer[] {
  return settings.mcpServers.filter((server) => server.isEnabled && server.url);
}

function assertValidMcpServerUrls(servers: McpServer[]) {
  for (const server of servers) {
    let parsedUrl: URL | null = null;

    try {
      parsedUrl = new URL(server.url);
    } catch {
      parsedUrl = null;
    }

    if (!parsedUrl || (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")) {
      throw new Error(`MCP 服务器「${server.name}」的 URL 无效，请填写完整的 http(s) 地址。`);
    }
  }
}

function parseSettingsInput(input: unknown) {
  const parsed = systemSettingsInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error("Invalid settings payload.");
  }

  const normalized = normalizeSystemSettings({
    tavilyApiKey: parsed.data.tavilyApiKey ?? "",
    exaApiKey: parsed.data.exaApiKey ?? "",
    providers: (parsed.data.providers ?? []).map((provider) => ({
      id: provider.id?.trim() || crypto.randomUUID(),
      name: provider.name?.trim() || defaultProviderSettings.name,
      baseUrl: provider.baseUrl?.trim() || defaultProviderSettings.baseUrl,
      apiKey: provider.apiKey?.trim() || "",
      protocol: provider.protocol ?? "chat-completion",
      isEnabled: provider.isEnabled ?? true,
      isDefault: provider.isDefault ?? false,
      models: (provider.models ?? []).map((model) => ({
        id: model.id?.trim() || crypto.randomUUID(),
        modelId: model.modelId?.trim() || "",
        isEnabled: model.isEnabled ?? true,
        isDefault: model.isDefault ?? false,
      })),
    })),
    mcpServers: (parsed.data.mcpServers ?? []).map((server) => ({
      id: server.id?.trim() || crypto.randomUUID(),
      name: server.name?.trim() || "MCP Server",
      url: server.url?.trim() || "",
      authType: server.authType ?? "header",
      oauthScopes: server.oauthScopes?.trim() || "",
      headers: (server.headers ?? []).map((header) => ({
        key: header.key?.trim() || "",
        value: header.value?.trim() || "",
      })),
      isEnabled: server.isEnabled ?? true,
    })),
    disabledSkills: parsed.data.disabledSkills ?? [],
  });

  assertValidMcpServerUrls(normalized.mcpServers);

  return normalized;
}

async function seedDefaultSystemSettings() {
  const existingSettings = db.select({ id: systemSettings.id }).from(systemSettings).limit(1).all()[0];

  if (existingSettings) {
    return;
  }

  await saveSystemSettings(buildDefaultSettingsFromEnv());
}

export async function ensureSystemSettings() {
  await ensureDatabase();
  await seedDefaultSystemSettings();
}

export async function getSystemSettings(): Promise<SystemSettings> {
  await ensureSystemSettings();

  const settingsRow = db.select().from(systemSettings)
    .where(eq(systemSettings.id, SETTINGS_ROW_ID))
    .all()[0];
  const providerRows = db.select().from(modelProviders).all();
  const modelRows = db.select().from(providerModels).all();
  const modelsByProviderId = new Map<string, typeof modelRows>();

  for (const row of modelRows) {
    const current = modelsByProviderId.get(row.providerId) ?? [];
    current.push(row);
    modelsByProviderId.set(row.providerId, current);
  }

  return normalizeSystemSettings({
    tavilyApiKey: settingsRow?.tavilyApiKey ?? "",
    exaApiKey: settingsRow?.exaApiKey ?? "",
    providers: providerRows.map((providerRow) => ({
      id: providerRow.id,
      name: providerRow.name,
      baseUrl: providerRow.baseUrl,
      apiKey: providerRow.apiKey,
      protocol: (providerRow.protocol as ProviderConfig["protocol"]) || "chat-completion",
      isEnabled: toBool(providerRow.isEnabled),
      isDefault: toBool(providerRow.isDefault),
      models: (modelsByProviderId.get(providerRow.id) ?? []).map((modelRow) => ({
        id: modelRow.id,
        modelId: modelRow.modelId,
        isEnabled: toBool(modelRow.isEnabled),
        isDefault: toBool(modelRow.isDefault),
      })),
    })),
    mcpServers: parseMcpServersColumn(settingsRow?.mcpServers),
    disabledSkills: parseDisabledSkillsColumn(settingsRow?.disabledSkills),
  });
}

export async function saveSystemSettings(input: unknown): Promise<SystemSettings> {
  await ensureDatabase();

  const normalized = parseSettingsInput(input);

  // 顺带清理 disabled 名单里已不存在的 skill，避免删除 skill 后死数据永久累积。
  // 仅在能成功读到 skill 目录时清理；目录缺失或读取失败时原样保留，避免目录临时
  // 不可见（如部署中 volume 尚未就绪）时误删用户的禁用选择。
  const existingSkillNames = await getExistingSkillNames();
  const disabledSkills = existingSkillNames
    ? normalized.disabledSkills.filter((name) => existingSkillNames.has(name))
    : normalized.disabledSkills;

  const now = Date.now();

  db.transaction((tx) => {
    const mcpServersJson = JSON.stringify(normalized.mcpServers);
    const disabledSkillsJson = JSON.stringify(disabledSkills);

    tx.insert(systemSettings)
      .values({
        id: SETTINGS_ROW_ID,
        tavilyApiKey: normalized.tavilyApiKey,
        exaApiKey: normalized.exaApiKey,
        mcpServers: mcpServersJson,
        disabledSkills: disabledSkillsJson,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: systemSettings.id,
        set: {
          tavilyApiKey: normalized.tavilyApiKey,
          exaApiKey: normalized.exaApiKey,
          mcpServers: mcpServersJson,
          disabledSkills: disabledSkillsJson,
          updatedAt: now,
        },
      })
      .run();

    tx.delete(providerModels).run();
    tx.delete(modelProviders).run();

    for (const provider of normalized.providers) {
      tx.insert(modelProviders)
        .values({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          protocol: provider.protocol || "chat-completion",
          isEnabled: toInt(provider.isEnabled),
          isDefault: toInt(provider.isDefault),
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const model of provider.models) {
        tx.insert(providerModels)
          .values({
            id: model.id,
            providerId: provider.id,
            modelId: model.modelId,
            isEnabled: toInt(model.isEnabled),
            isDefault: toInt(model.isDefault),
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }
  });

  // Drop OAuth sessions for MCP servers the user just removed.
  deleteSessionsNotIn(normalized.mcpServers.map((server) => server.id));

  // Drop OAuth sessions that are no longer valid for the saved config:
  //  - switched away from OAuth → the stored token is orphaned (data hygiene);
  //  - re-pointed URL → the token was minted for the old authorization server,
  //    so it must not leak to the new origin and the UI should show needs re-auth.
  for (const server of normalized.mcpServers) {
    const session = readSession(server.id);
    if (!session) continue;
    if (server.authType !== "oauth") {
      deleteSession(server.id);
    } else if (session.serverUrl && session.serverUrl !== server.url) {
      deleteSession(server.id);
    }
  }

  // Config may have changed (URL/headers/scopes/auth); drop reused MCP
  // connections so the next request reconnects with the new settings.
  invalidateMcpCache();

  return getSystemSettings();
}

export async function getRuntimeProviderConfig(): Promise<ProviderConfig> {
  const settings = await getSystemSettings();
  return getRuntimeProviderConfigFromSettings(settings);
}

export async function getEnabledMcpServers(): Promise<McpServer[]> {
  const settings = await getSystemSettings();
  return getEnabledMcpServersFromSettings(settings);
}

export async function getProviderConfigByOverride(
  providerId: string,
  modelId: string,
): Promise<ProviderConfig> {
  const settings = await getSystemSettings();
  return getProviderConfigByOverrideFromSettings(settings, providerId, modelId);
}

export function resolveProviderConfig(input: unknown): ProviderConfig {
  const parsed = providerConfigInputSchema.safeParse(input);

  if (!parsed.success) {
    return envProviderConfig;
  }

  return normalizeProviderConfig({
    providerName: envProviderConfig.providerName,
    baseUrl: parsed.data.baseUrl || envProviderConfig.baseUrl,
    apiKey: parsed.data.apiKey || envProviderConfig.apiKey,
    model: parsed.data.model || envProviderConfig.model,
    protocol: parsed.data.protocol || envProviderConfig.protocol,
    tavilyApiKey: parsed.data.tavilyApiKey || envProviderConfig.tavilyApiKey,
    exaApiKey: parsed.data.exaApiKey || envProviderConfig.exaApiKey,
  });
}
