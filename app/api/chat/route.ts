import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { getChatModel, resolveProviderConfig } from "@/lib/ai/model";
import { systemPrompt } from "@/lib/ai/system-prompt";
import { createAgentTools } from "@/lib/ai/tools";
import { persistFinishedConversation, persistIncomingMessages, generateConversationTitle } from "@/lib/persistence";
import type { AgentTimelineStep, ChatUIMessage } from "@/lib/observability";
import { providerConfigInputSchema } from "@/lib/provider-config";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  conversationId: z.string().trim().min(1),
  messages: z.array(z.custom<ChatUIMessage>()),
  providerConfig: providerConfigInputSchema.optional(),
});

const urlPattern = /https?:\/\/[^\s)>"'`]+/gi;

function stripMessageId(message: ChatUIMessage): Omit<ChatUIMessage, "id"> {
  const { id, ...rest } = message;
  void id;
  return rest;
}

function toNonNegativeInt(value: number | undefined) {
  return value === undefined ? 0 : Math.max(0, Math.round(value));
}

function extractLatestUserText(messages: ChatUIMessage[]) {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  if (!latestUserMessage) {
    return "";
  }

  return latestUserMessage.parts
    .filter((part): part is Extract<(typeof latestUserMessage.parts)[number], { type: "text" }> =>
      part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function buildRuntimeSystemPrompt(messages: ChatUIMessage[]) {
  const now = new Date();
  const currentDateTime = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone: "Asia/Shanghai",
  }).format(now);
  const latestUserText = extractLatestUserText(messages);
  const urls = latestUserText.match(urlPattern) ?? [];
  const basePrompt = `${systemPrompt}

当前系统时间（Asia/Shanghai）: ${currentDateTime}
当前 ISO 时间: ${now.toISOString()}
- 回答涉及“今天”“昨天”“明天”“本周”“最近”等相对时间时，要以上述当前时间为准理解用户问题
- 如果需要调用 WebSearch 查询时效性信息，先用英文关键词搜索，再用用户所使用的语言总结回答`
    .trim();

  if (urls.length === 0) {
    return basePrompt;
  }

  return `${basePrompt}

本轮用户消息中已经提供了明确 URL。
- 如果用户是在让你读取、总结、分析、核对、提取这个链接的内容，优先调用 WebFetch，不要先调用 WebSearch
- 只有在该 URL 无法抓取、用户同时还要求补充更多外部来源，或给出的链接并不足以回答问题时，才再考虑调用 WebSearch
- 如果提供了多个 URL，优先抓取与用户问题最相关的那个`
    .trim();
}

export async function POST(request: Request) {
  const json = await request.json();
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request: missing valid conversation or messages.",
      },
      { status: 400 },
    );
  }

  const providerConfig = resolveProviderConfig(parsed.data.providerConfig);
  const agentTools = createAgentTools(providerConfig);
  const runtimeSystemPrompt = buildRuntimeSystemPrompt(parsed.data.messages);

  const modelMessages = await convertToModelMessages(
    parsed.data.messages.map(stripMessageId),
    {
      tools: agentTools,
    },
  );

  if (!providerConfig.apiKey || !providerConfig.model) {
    return Response.json(
      {
        error:
          "No valid model configuration. Please configure base URL, API Key and model at /settings, or set OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL environment variables.",
      },
      { status: 400 },
    );
  }

  await persistIncomingMessages(parsed.data.conversationId, parsed.data.messages);

  const requestStartedAt = Date.now();
  const stepStartTimes = new Map<number, number>();
  const timeline: AgentTimelineStep[] = [];
  let requestFinishedAt: number | undefined;

  const result = streamText({
    model: getChatModel(providerConfig),
    system: runtimeSystemPrompt,
    messages: modelMessages,
    tools: agentTools,
    stopWhen: stepCountIs(5),
    experimental_onStepStart: ({ stepNumber }) => {
      stepStartTimes.set(stepNumber, Date.now());
    },
    onStepFinish: (step) => {
      const finishedAt = Date.now();
      const startedAt = stepStartTimes.get(step.stepNumber) ?? finishedAt;

      timeline.push({
        event: "step-finish",
        stepNumber: step.stepNumber,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        finishReason: step.finishReason,
        provider: step.model.provider,
        modelId: step.model.modelId,
        text: step.text,
        toolCalls: step.toolCalls.map((toolCall) => ({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
        })),
        toolResults: step.toolResults.map((toolResult) => ({
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
        })),
        usage: {
          inputTokens: toNonNegativeInt(step.usage.inputTokens),
          outputTokens: toNonNegativeInt(step.usage.outputTokens),
          totalTokens: toNonNegativeInt(step.usage.totalTokens),
          reasoningTokens: toNonNegativeInt(
            step.usage.outputTokenDetails.reasoningTokens ?? step.usage.reasoningTokens,
          ),
          cachedInputTokens: toNonNegativeInt(
            step.usage.inputTokenDetails.cacheReadTokens ?? step.usage.cachedInputTokens,
          ),
        },
      });

      stepStartTimes.delete(step.stepNumber);
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: parsed.data.messages,
    messageMetadata: ({ part }) => {
      if (part.type === "start") {
        return {
          createdAt: requestStartedAt,
          status: "streaming" as const,
          startedAt: requestStartedAt,
          timeline: [],
        };
      }

      if (part.type === "finish-step") {
        return {
          createdAt: requestStartedAt,
          status: "streaming" as const,
          startedAt: requestStartedAt,
          timeline,
        };
      }

      if (part.type === "finish") {
        requestFinishedAt ??= Date.now();

        return {
          createdAt: requestStartedAt,
          status: "finished" as const,
          startedAt: requestStartedAt,
          finishedAt: requestFinishedAt,
          totalDurationMs: Math.max(0, requestFinishedAt - requestStartedAt),
          timeline,
        };
      }
    },
    onFinish: async ({ messages }) => {
      await persistFinishedConversation(parsed.data.conversationId, messages);

      const userMessages = messages.filter((m) => m.role === "user");
      const assistantMessages = messages.filter((m) => m.role === "assistant");

      if (userMessages.length === 1 && assistantMessages.length === 1) {
        after(async () => {
          await generateConversationTitle(
            parsed.data.conversationId,
            messages,
            providerConfig,
          );
        });
      }
    },
  });
}
