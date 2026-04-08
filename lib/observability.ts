import type { UIMessage } from "ai";
import { z } from "zod";

const agentTimelineToolSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
});

export const agentTimelineStepSchema = z.object({
  event: z.literal("step-finish"),
  stepNumber: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  finishReason: z.string(),
  provider: z.string(),
  modelId: z.string(),
  text: z.string(),
  toolCalls: z.array(agentTimelineToolSchema),
  toolResults: z.array(agentTimelineToolSchema),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
  }),
});

export const agentObservabilitySchema = z.object({
  status: z.enum(["streaming", "finished"]),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
  totalDurationMs: z.number().int().nonnegative().optional(),
  timeline: z.array(agentTimelineStepSchema),
});

export type AgentTimelineStep = z.infer<typeof agentTimelineStepSchema>;
export type AgentObservability = z.infer<typeof agentObservabilitySchema>;
export type ChatMessageMetadata = Partial<AgentObservability> & {
  createdAt?: number;
  interrupted?: boolean;
};
export type ChatUIMessage = UIMessage<ChatMessageMetadata>;

export function parseAgentObservability(
  metadata: unknown,
): AgentObservability | null {
  const parsed = agentObservabilitySchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

export function getMessageTimestamp(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const record = metadata as {
    createdAt?: unknown;
    startedAt?: unknown;
  };

  if (typeof record.createdAt === "number") {
    return record.createdAt;
  }

  if (typeof record.startedAt === "number") {
    return record.startedAt;
  }

  return null;
}

export function isInterruptedMessage(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") {
    return false;
  }

  const record = metadata as { interrupted?: unknown };
  return record.interrupted === true;
}

export function finalizeInterruptedMessage(
  message: ChatUIMessage,
): ChatUIMessage {
  if (message.role !== "assistant") {
    return message;
  }

  const observability = parseAgentObservability(message.metadata);

  if (!observability || observability.status !== "streaming") {
    return message;
  }

  const lastStepFinishedAt = observability.timeline.reduce<number | null>((maxValue, step) => {
    return maxValue === null ? step.finishedAt : Math.max(maxValue, step.finishedAt);
  }, null);
  const finishedAt = Math.max(
    observability.startedAt,
    lastStepFinishedAt ?? observability.startedAt,
  );

  return {
    ...message,
    metadata: {
      ...message.metadata,
      status: "finished",
      finishedAt,
      totalDurationMs: Math.max(0, finishedAt - observability.startedAt),
      interrupted: true,
    },
  };
}
