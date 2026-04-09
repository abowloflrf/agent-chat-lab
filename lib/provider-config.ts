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

export const systemSettingsSchema = z.object({
  tavilyApiKey: z.string().trim().default(""),
  providers: z.array(providerSettingsSchema).default([]),
});

export const systemSettingsInputSchema = z.object({
  tavilyApiKey: z.string().trim().optional(),
  providers: z.array(providerSettingsInputSchema).optional(),
});

export const providerConfigSchema = z.object({
  baseUrl: z.string().trim().default("https://api.openai.com/v1"),
  apiKey: z.string().trim().default(""),
  model: z.string().trim().default(""),
  protocol: providerProtocolSchema,
  tavilyApiKey: z.string().trim().default(""),
});

export const providerConfigInputSchema = z.object({
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  model: z.string().trim().optional(),
  protocol: z.enum(providerProtocols).optional(),
  tavilyApiKey: z.string().trim().optional(),
});

export type ProviderModel = z.infer<typeof providerModelSchema>;
export type ProviderSettings = z.infer<typeof providerSettingsSchema>;
export type SystemSettings = z.infer<typeof systemSettingsSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const defaultProviderConfig: ProviderConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
  protocol: "chat-completion",
  tavilyApiKey: "",
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
  providers: [defaultProviderSettings],
};

export function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  return {
    baseUrl: (config.baseUrl || defaultProviderConfig.baseUrl).trim().replace(/\/+$/, ""),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    protocol: config.protocol || "chat-completion",
    tavilyApiKey: config.tavilyApiKey.trim(),
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
    providers: normalizedProviders.map((provider) => ({
      ...provider,
      isDefault: defaultProviderId === provider.id,
    })),
  };
}
