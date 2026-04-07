import { createOpenAI } from "@ai-sdk/openai";
import {
  defaultProviderConfig,
  normalizeProviderConfig,
  providerConfigInputSchema,
  type ProviderConfig,
} from "@/lib/provider-config";

const envProviderConfig: ProviderConfig = normalizeProviderConfig({
  baseUrl: process.env.OPENAI_BASE_URL ?? defaultProviderConfig.baseUrl,
  apiKey: process.env.OPENAI_API_KEY ?? "",
  model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
});

export function resolveProviderConfig(input: unknown): ProviderConfig {
  const parsed = providerConfigInputSchema.safeParse(input);

  if (!parsed.success) {
    return envProviderConfig;
  }

  return normalizeProviderConfig({
    baseUrl: parsed.data.baseUrl || envProviderConfig.baseUrl,
    apiKey: parsed.data.apiKey || envProviderConfig.apiKey,
    model: parsed.data.model || envProviderConfig.model,
  });
}

export function getChatModel(config: ProviderConfig) {
  const provider = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });

  return provider.chat(config.model);
}
