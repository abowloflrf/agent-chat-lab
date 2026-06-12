import type { UIMessage } from "ai";
import { z } from "zod";
import { ASK_USER_QUESTION_PART_TYPE } from "@/lib/ai/ask-user-question";

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

/**
 * Settle tool parts that a dead run left in a non-terminal state.
 *
 * Without this, dangling parts render as forever-spinning "running" rows, and
 * `input-available` / `approval-responded` parts would later make
 * `convertToModelMessages` emit a tool-call with no tool-result, failing the
 * next request. Rules:
 * - `input-streaming`: the input never finished, no valid tool-call can be
 *   reconstructed — drop the part (including AskUserQuestion).
 * - `input-available` (non-question): patch to an interruption error.
 * - `approval-responded` with no output: the response was recorded but the
 *   execution died mid-flight — denied ones settle to `output-denied`,
 *   approved ones to an interruption error.
 * - AskUserQuestion `input-available` stays: still answerable after recovery,
 *   and the server resolves it as "unanswered" otherwise.
 * - `approval-requested` stays: still approvable when it is the last message;
 *   the server auto-rejects it on the next request if the user moves on.
 *
 * Returns the original array when nothing needed settling, so callers can
 * cheaply detect "no change".
 */
function settleInterruptedToolParts(
  parts: ChatUIMessage["parts"],
): ChatUIMessage["parts"] {
  let changed = false;

  const nextParts = parts.flatMap((part) => {
    const isToolPart =
      part.type === "dynamic-tool" || part.type.startsWith("tool-");

    if (!isToolPart || !("state" in part)) {
      return [part];
    }

    if (part.state === "input-streaming") {
      changed = true;
      return [];
    }

    if (
      part.state === "input-available" &&
      part.type !== ASK_USER_QUESTION_PART_TYPE
    ) {
      changed = true;
      return [
        {
          ...part,
          state: "output-error",
          errorText: "执行被中断，未返回结果。",
        } as ChatUIMessage["parts"][number],
      ];
    }

    if (
      part.state === "approval-responded" &&
      !("output" in part && part.output !== undefined)
    ) {
      changed = true;
      const approval = (part as { approval?: { approved?: boolean } }).approval;

      if (approval?.approved === false) {
        return [
          { ...part, state: "output-denied" } as ChatUIMessage["parts"][number],
        ];
      }

      return [
        {
          ...part,
          state: "output-error",
          errorText: "已批准但执行被中断，未返回结果。",
        } as ChatUIMessage["parts"][number],
      ];
    }

    return [part];
  });

  return changed ? nextParts : parts;
}

export function finalizeInterruptedMessage(
  message: ChatUIMessage,
): ChatUIMessage {
  if (message.role !== "assistant") {
    return message;
  }

  // 无论 metadata 状态如何都先整理悬空工具 part——旧代码持久化的历史里
  // 存在 metadata 已是 finished、parts 却停在 input-available 的快照。
  const settledParts = settleInterruptedToolParts(message.parts);
  const observability = parseAgentObservability(message.metadata);

  if (!observability || observability.status !== "streaming") {
    return settledParts === message.parts
      ? message
      : { ...message, parts: settledParts };
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
    parts: settledParts,
    metadata: {
      ...message.metadata,
      status: "finished",
      finishedAt,
      totalDurationMs: Math.max(0, finishedAt - observability.startedAt),
      interrupted: true,
    },
  };
}
