import { z } from "zod";

export const DEBOUNCE_DELAY_MS = 450;
export const providerConfigStorageKey = "agent-chat-lab.provider-config";
export const providerConfigChangedEvent = "agent-chat-lab:provider-config-changed";

export const providerConfigSchema = z.object({
  baseUrl: z.string().trim().default("https://api.openai.com/v1"),
  apiKey: z.string().trim().default(""),
  model: z.string().trim().default(""),
});

export const providerConfigInputSchema = z.object({
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().trim().optional(),
  model: z.string().trim().optional(),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const defaultProviderConfig: ProviderConfig = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "",
};

export function normalizeProviderConfig(config: ProviderConfig): ProviderConfig {
  return {
    baseUrl: (config.baseUrl || defaultProviderConfig.baseUrl).trim().replace(/\/+$/, ""),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
  };
}

export function loadProviderConfigFromStorage(): ProviderConfig {
  if (typeof window === "undefined") {
    return defaultProviderConfig;
  }

  const raw = window.localStorage.getItem(providerConfigStorageKey);

  if (!raw) {
    return defaultProviderConfig;
  }

  try {
    const parsed = providerConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? normalizeProviderConfig(parsed.data)
      : defaultProviderConfig;
  } catch {
    return defaultProviderConfig;
  }
}

export function saveProviderConfigToStorage(config: ProviderConfig) {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = normalizeProviderConfig(config);
  window.localStorage.setItem(
    providerConfigStorageKey,
    JSON.stringify(normalized),
  );
  window.dispatchEvent(new Event(providerConfigChangedEvent));
}
