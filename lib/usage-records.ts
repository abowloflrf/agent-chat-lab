import { toDayKey } from "@/lib/datetime";
import { parseAgentObservability } from "@/lib/observability";
import type { ChatUIMessage } from "@/lib/observability";
import type { usageRecords } from "@/lib/db/schema";

// One insert-ready row per agent timeline step (id is auto-assigned by SQLite).
export type UsageRecordSeed = Omit<typeof usageRecords.$inferInsert, "id">;

// Expand a single assistant message's observability metadata into per-step rows.
export function expandMessageUsageRecords(
  conversationId: string,
  messageId: string,
  metadata: unknown,
): UsageRecordSeed[] {
  const observability = parseAgentObservability(metadata);

  if (!observability) {
    return [];
  }

  return observability.timeline.map((step) => ({
    conversationId,
    messageId,
    stepNumber: step.stepNumber,
    provider: step.provider,
    modelId: step.modelId,
    finishReason: step.finishReason,
    inputTokens: step.usage.inputTokens,
    outputTokens: step.usage.outputTokens,
    totalTokens: step.usage.totalTokens,
    reasoningTokens: step.usage.reasoningTokens,
    cachedInputTokens: step.usage.cachedInputTokens,
    durationMs: step.durationMs,
    toolCallCount: step.toolCalls.length,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    dayKey: toDayKey(step.startedAt),
  }));
}

// Expand every assistant message in a conversation snapshot into usage rows.
export function buildConversationUsageRecords(
  conversationId: string,
  chatMessages: ChatUIMessage[],
): UsageRecordSeed[] {
  return chatMessages
    .filter((message) => message.role === "assistant")
    .flatMap((message) =>
      expandMessageUsageRecords(conversationId, message.id, message.metadata),
    );
}
