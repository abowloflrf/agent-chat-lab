import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRawValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function firstStringField(
  record: Record<string, unknown> | undefined,
  keys: string[],
) {
  if (!record) {
    return "";
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return "";
}

function extractReasoningContentFromChoice(choice: unknown) {
  if (!isRecord(choice)) {
    return "";
  }

  const delta = isRecord(choice.delta) ? choice.delta : undefined;
  const message = isRecord(choice.message) ? choice.message : undefined;
  const keys = ["reasoning_content", "reasoningContent"];

  return firstStringField(delta, keys) || firstStringField(message, keys);
}

function extractReasoningContent(rawValue: unknown) {
  const parsed = parseRawValue(rawValue);

  if (!isRecord(parsed)) {
    return "";
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  return choices.map(extractReasoningContentFromChoice).join("");
}

function isNativeReasoningPart(part: TextStreamPart<ToolSet>) {
  return (
    part.type === "reasoning-start" ||
    part.type === "reasoning-delta" ||
    part.type === "reasoning-end"
  );
}

function shouldCloseReasoningBefore(part: TextStreamPart<ToolSet>) {
  // 这些是流的边界/占位事件，不代表答案正文开始，必须让推理跨越它们继续聚合：
  // - raw：原始 chunk，推理正是从中提取
  // - start / start-step：运行 / 步骤边界
  // - text-start / text-end：文本块边界。部分 OpenAI 兼容 provider（如豆包）在推理
  //   阶段就发 content:""，使 provider 提前 enqueue 一个 text-start；若据此关闭推理，
  //   后续 reasoning_content 会另起新段，导致「推理1 + 回复 + 推理2」式割裂。
  if (
    part.type === "raw" ||
    part.type === "start" ||
    part.type === "start-step" ||
    part.type === "text-start" ||
    part.type === "text-end"
  ) {
    return false;
  }

  // 仅当出现非空正文时才视为答案开始；空 text-delta（推理阶段的占位 content:""）忽略。
  if (part.type === "text-delta") {
    return part.text.length > 0;
  }

  // 其余（工具调用、source/file、finish/finish-step、error/abort 等）都意味着推理已结束。
  return true;
}

export function createOpenAICompatibleChatReasoningTransform<
  TOOLS extends ToolSet,
>(): StreamTextTransform<TOOLS> {
  return () => {
    type Part = TextStreamPart<TOOLS>;

    let activeReasoningId: string | null = null;
    let reasoningIndex = 0;
    let nativeReasoningSeen = false;

    function openReasoning(
      controller: TransformStreamDefaultController<Part>,
    ) {
      if (activeReasoningId !== null) {
        return activeReasoningId;
      }

      activeReasoningId = `chat-reasoning-${reasoningIndex}`;
      reasoningIndex += 1;
      controller.enqueue({
        type: "reasoning-start",
        id: activeReasoningId,
      } as Part);
      return activeReasoningId;
    }

    function closeReasoning(
      controller: TransformStreamDefaultController<Part>,
    ) {
      if (activeReasoningId === null) {
        return;
      }

      controller.enqueue({
        type: "reasoning-end",
        id: activeReasoningId,
      } as Part);
      activeReasoningId = null;
    }

    return new TransformStream<Part, Part>({
      transform(part, controller) {
        if (isNativeReasoningPart(part as TextStreamPart<ToolSet>)) {
          nativeReasoningSeen = true;
          closeReasoning(controller);
          controller.enqueue(part);
          return;
        }

        if (!nativeReasoningSeen && part.type === "raw") {
          const reasoningText = extractReasoningContent(part.rawValue);

          if (reasoningText.length > 0) {
            const id = openReasoning(controller);
            controller.enqueue({
              type: "reasoning-delta",
              id,
              text: reasoningText,
            } as Part);
          }

          controller.enqueue(part);
          return;
        }

        if (shouldCloseReasoningBefore(part as TextStreamPart<ToolSet>)) {
          closeReasoning(controller);
        }

        controller.enqueue(part);
      },
      flush(controller) {
        closeReasoning(controller);
      },
    });
  };
}
