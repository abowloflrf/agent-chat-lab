import "server-only";

import { eq } from "drizzle-orm";
import { db, ensureDatabase } from "@/lib/db/client";
import { modelProviders, providerModels, systemSettings } from "@/lib/db/schema";
import {
  defaultProviderConfig,
  defaultProviderSettings,
  normalizeProviderConfig,
  normalizeSystemSettings,
  providerConfigInputSchema,
  systemSettingsInputSchema,
  type ProviderConfig,
  type ProviderSettings,
  type SystemSettings,
} from "@/lib/provider-config";

const SETTINGS_ROW_ID = 1;

const envProviderConfig: ProviderConfig = normalizeProviderConfig({
  baseUrl: process.env.OPENAI_BASE_URL ?? defaultProviderConfig.baseUrl,
  apiKey: process.env.OPENAI_API_KEY ?? "",
  model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  tavilyApiKey: process.env.TAVILY_API_KEY ?? "",
});

function toBool(value: number) {
  return value === 1;
}

function toInt(value: boolean) {
  return value ? 1 : 0;
}

function buildDefaultSettingsFromEnv(): SystemSettings {
  return normalizeSystemSettings({
    tavilyApiKey: envProviderConfig.tavilyApiKey,
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

function parseSettingsInput(input: unknown) {
  const parsed = systemSettingsInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error("Invalid settings payload.");
  }

  return normalizeSystemSettings({
    tavilyApiKey: parsed.data.tavilyApiKey ?? "",
    providers: (parsed.data.providers ?? []).map((provider) => ({
      id: provider.id?.trim() || crypto.randomUUID(),
      name: provider.name?.trim() || defaultProviderSettings.name,
      baseUrl: provider.baseUrl?.trim() || defaultProviderSettings.baseUrl,
      apiKey: provider.apiKey?.trim() || "",
      isEnabled: provider.isEnabled ?? true,
      isDefault: provider.isDefault ?? false,
      models: (provider.models ?? []).map((model) => ({
        id: model.id?.trim() || crypto.randomUUID(),
        modelId: model.modelId?.trim() || "",
        isEnabled: model.isEnabled ?? true,
        isDefault: model.isDefault ?? false,
      })),
    })),
  });
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
    providers: providerRows.map((providerRow) => ({
      id: providerRow.id,
      name: providerRow.name,
      baseUrl: providerRow.baseUrl,
      apiKey: providerRow.apiKey,
      isEnabled: toBool(providerRow.isEnabled),
      isDefault: toBool(providerRow.isDefault),
      models: (modelsByProviderId.get(providerRow.id) ?? []).map((modelRow) => ({
        id: modelRow.id,
        modelId: modelRow.modelId,
        isEnabled: toBool(modelRow.isEnabled),
        isDefault: toBool(modelRow.isDefault),
      })),
    })),
  });
}

export async function saveSystemSettings(input: unknown): Promise<SystemSettings> {
  await ensureDatabase();

  const normalized = parseSettingsInput(input);
  const now = Date.now();

  db.transaction((tx) => {
    tx.insert(systemSettings)
      .values({
        id: SETTINGS_ROW_ID,
        tavilyApiKey: normalized.tavilyApiKey,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: systemSettings.id,
        set: {
          tavilyApiKey: normalized.tavilyApiKey,
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

  return getSystemSettings();
}

export async function getRuntimeProviderConfig(): Promise<ProviderConfig> {
  const settings = await getSystemSettings();
  const provider = pickActiveProvider(settings.providers);
  const model = pickActiveModel(provider);

  if (!provider || !model) {
    return envProviderConfig;
  }

  return normalizeProviderConfig({
    baseUrl: provider.baseUrl || envProviderConfig.baseUrl,
    apiKey: provider.apiKey || envProviderConfig.apiKey,
    model: model.modelId || envProviderConfig.model,
    tavilyApiKey: settings.tavilyApiKey || envProviderConfig.tavilyApiKey,
  });
}

export function resolveProviderConfig(input: unknown): ProviderConfig {
  const parsed = providerConfigInputSchema.safeParse(input);

  if (!parsed.success) {
    return envProviderConfig;
  }

  return normalizeProviderConfig({
    baseUrl: parsed.data.baseUrl || envProviderConfig.baseUrl,
    apiKey: parsed.data.apiKey || envProviderConfig.apiKey,
    model: parsed.data.model || envProviderConfig.model,
    tavilyApiKey: parsed.data.tavilyApiKey || envProviderConfig.tavilyApiKey,
  });
}
