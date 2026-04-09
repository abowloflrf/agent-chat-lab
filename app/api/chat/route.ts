import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { after } from "next/server";
import { z } from "zod";
import { getChatModel } from "@/lib/ai/model";
import {
  buildTimeContextPrompt,
  buildUrlContextPrompt,
  systemPrompt,
} from "@/lib/ai/system-prompt";
import { createAgentTools } from "@/lib/ai/tools";
import { persistFinishedConversation, persistIncomingMessages, generateConversationTitle } from "@/lib/persistence";
import type { AgentTimelineStep, ChatUIMessage } from "@/lib/observability";
import { getRuntimeProviderConfig } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  conversationId: z.string().trim().min(1),
  messages: z.array(z.custom<ChatUIMessage>()),
});

const urlPattern = /https?:\/\/[^\s)>"'`]+/gi;

function stripMessageId(message: ChatUIMessage): Omit<ChatUIMessage, "id"> {
  const { id, ...rest } = message;
  void id;
  return rest;
}

/**
 * Auto-reject any tool calls still in "approval-requested" state.
 *
 * When a high-risk Bash command is blocked and the user sends a new message
 * without clicking "Reject", the conversation history contains a tool call
 * with no tool result.  `convertToModelMessages` faithfully emits the
 * tool-call but never emits a matching tool-result, which makes the model
 * API return "Tool result is missing for tool call …".
 *
 * This function patches those dangling parts to "output-denied" so the SDK
 * can generate a proper tool-result / tool-approval-response pair.
 */
function autoRejectPendingApprovals(messages: ChatUIMessage[]): ChatUIMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") {
      return message;
    }

    let changed = false;
    const nextParts = message.parts.map((part) => {
      const isToolPart =
        part.type === "dynamic-tool" || part.type.startsWith("tool-");
      if (
        !isToolPart ||
        !("state" in part) ||
        part.state !== "approval-requested"
      ) {
        return part;
      }

      changed = true;
      const toolCallId = part.toolCallId;
      const existingApproval = part.approval as { id: string } | undefined;
      const approvalId = existingApproval?.id ?? `auto-reject-${toolCallId}`;

      return {
        ...part,
        state: "output-denied" as const,
        approval: {
          id: approvalId,
          approved: false as const,
          reason: "工具调用未经用户审批，已自动拒绝。",
        },
      };
    });

    return changed ? { ...message, parts: nextParts } : message;
  });
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
  const promptSections = [systemPrompt];

  if (urls.length > 0) {
    promptSections.push(buildUrlContextPrompt());
  }

  promptSections.push(buildTimeContextPrompt(currentDateTime, now.toISOString()));

  return promptSections.join("\n\n").trim();
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

  const providerConfig = await getRuntimeProviderConfig();
  const agentTools = createAgentTools(providerConfig);
  const runtimeSystemPrompt = buildRuntimeSystemPrompt(parsed.data.messages);

  const sanitizedMessages = autoRejectPendingApprovals(parsed.data.messages);
  const modelMessages = await convertToModelMessages(
    sanitizedMessages.map(stripMessageId),
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

  await persistIncomingMessages(parsed.data.conversationId, sanitizedMessages);

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
