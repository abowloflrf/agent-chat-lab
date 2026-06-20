import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderConfig } from "@/lib/provider-config";
import { resolveProviderConfig } from "@/lib/settings";

export { resolveProviderConfig };

export function getChatModel(config: ProviderConfig) {
  switch (config.protocol) {
    case "openai-response": {
      const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider.responses(config.model);
    }
    case "anthropic-message": {
      const provider = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
      return provider(config.model);
    }
    default: {
      const provider = createOpenAICompatible({
        name: config.providerName || "openai-compatible",
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        includeUsage: true,
      });
      return provider.chatModel(config.model);
    }
  }
}
