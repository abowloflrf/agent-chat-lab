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
  return part.type !== "raw" && part.type !== "start" && part.type !== "start-step";
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
