import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderConfig } from "@/lib/provider-config";
import { resolveProviderConfig } from "@/lib/settings";

export { resolveProviderConfig };

export function getChatModel(config: ProviderConfig) {
  const provider = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });

  return provider.chat(config.model);
}
