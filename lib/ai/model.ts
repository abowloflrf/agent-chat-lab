import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { extractReasoningMiddleware, wrapLanguageModel } from "ai";
import type { ProviderConfig } from "@/lib/provider-config";
import { resolveProviderConfig } from "@/lib/settings";

export { resolveProviderConfig };

// Mirror Claude Code's per-session header so the conversation id travels with
// every outbound LLM request (gateways use it for sticky routing / tracing).
export const SESSION_ID_HEADER = "X-Claude-Code-Session_Id";

/** Build the per-request session header for a given conversation. */
export function sessionHeaders(sessionId: string): Record<string, string> {
  return { [SESSION_ID_HEADER]: sessionId };
}

// Some OpenAI-compatible models (e.g. Gemma via Google's compat layer,
// DeepSeek-R1 distills) inline chain-of-thought as literal tags in `content`
// instead of a separate `reasoning_content` field. Split those out so they
// render as reasoning, not body text. No-op for models without these tags.
const inlineReasoningMiddleware = [
  extractReasoningMiddleware({ tagName: "thought" }),
  extractReasoningMiddleware({ tagName: "think" }),
];

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
      return wrapLanguageModel({
        model: provider.chatModel(config.model),
        middleware: inlineReasoningMiddleware,
      });
    }
  }
}
