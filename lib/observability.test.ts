import { describe, it, expect } from "vitest";
import {
  parseAgentObservability,
  getMessageTimestamp,
  isInterruptedMessage,
  finalizeInterruptedMessage,
  type AgentObservability,
  type AgentTimelineStep,
  type ChatMessageMetadata,
  type ChatUIMessage,
} from "@/lib/observability";
import { ASK_USER_QUESTION_PART_TYPE } from "@/lib/ai/ask-user-question";

type Part = ChatUIMessage["parts"][number];

// ---------------------------------------------------------------------------
// Minimal typed fixtures
// ---------------------------------------------------------------------------

function makeTimelineStep(
  overrides: Partial<AgentTimelineStep> = {},
): AgentTimelineStep {
  return {
    event: "step-finish",
    stepNumber: 0,
    startedAt: 1_000,
    finishedAt: 2_000,
    durationMs: 1_000,
    finishReason: "stop",
    provider: "openai",
    modelId: "gpt-test",
    text: "hi",
    toolCalls: [],
    toolResults: [],
    usage: {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    },
    ...overrides,
  };
}

function makeObservability(
  overrides: Partial<AgentObservability> = {},
): AgentObservability {
  return {
    status: "finished",
    startedAt: 1_000,
    finishedAt: 2_000,
    totalDurationMs: 1_000,
    timeline: [],
    ...overrides,
  };
}

// A tool part is structurally `{ type, toolCallId, state, ... }`. The exported
// `ChatUIMessage["parts"][number]` union is a heavily-discriminated type whose
// per-state shapes are awkward to satisfy by hand for arbitrary tool names, so
// build the object loosely and cast it once at the boundary. The double cast
// goes through `unknown` to stay clear of `any`.
function toolPart(fields: Record<string, unknown>): Part {
  return fields as unknown as Part;
}

function textPart(text: string): Part {
  return { type: "text", text };
}

function makeMessage(
  parts: Part[],
  metadata?: ChatMessageMetadata,
  role: ChatUIMessage["role"] = "assistant",
): ChatUIMessage {
  return { id: "m1", role, parts, metadata };
}

// ---------------------------------------------------------------------------
// parseAgentObservability
// ---------------------------------------------------------------------------

describe("parseAgentObservability", () => {
  it("returns the parsed object for valid metadata", () => {
    const input = makeObservability({
      status: "streaming",
      timeline: [makeTimelineStep()],
    });
    const result = parseAgentObservability(input);
    expect(result).not.toBeNull();
    expect(result?.status).toBe("streaming");
    expect(result?.timeline).toHaveLength(1);
  });

  it("accepts minimal metadata with optional fields omitted", () => {
    const result = parseAgentObservability({
      status: "finished",
      startedAt: 0,
      timeline: [],
    });
    expect(result).toEqual({ status: "finished", startedAt: 0, timeline: [] });
  });

  it("returns null for an unknown status value", () => {
    expect(
      parseAgentObservability({ status: "pending", startedAt: 0, timeline: [] }),
    ).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(parseAgentObservability({ status: "finished" })).toBeNull();
  });

  it("returns null for negative startedAt (nonnegative constraint)", () => {
    expect(
      parseAgentObservability({ status: "finished", startedAt: -1, timeline: [] }),
    ).toBeNull();
  });

  it("returns null when a timeline step is malformed", () => {
    expect(
      parseAgentObservability({
        status: "finished",
        startedAt: 0,
        timeline: [{ event: "step-finish" }],
      }),
    ).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseAgentObservability(null)).toBeNull();
    expect(parseAgentObservability(undefined)).toBeNull();
    expect(parseAgentObservability("nope")).toBeNull();
    expect(parseAgentObservability(42)).toBeNull();
  });

  it("parses and keeps the optional finishedAt / totalDurationMs fields", () => {
    const result = parseAgentObservability({
      status: "finished",
      startedAt: 1_000,
      finishedAt: 4_000,
      totalDurationMs: 3_000,
      timeline: [],
    });
    expect(result).toEqual({
      status: "finished",
      startedAt: 1_000,
      finishedAt: 4_000,
      totalDurationMs: 3_000,
      timeline: [],
    });
  });

  it("strips unknown keys rather than rejecting them (zod default strip)", () => {
    const result = parseAgentObservability({
      status: "finished",
      startedAt: 0,
      timeline: [],
      extraneous: "should-be-dropped",
      createdAt: 999,
    });
    // The schema is not .strict(), so extra keys are silently removed.
    expect(result).toEqual({ status: "finished", startedAt: 0, timeline: [] });
    expect(result).not.toHaveProperty("extraneous");
    expect(result).not.toHaveProperty("createdAt");
  });

  it("returns null when a numeric field is not an integer", () => {
    expect(
      parseAgentObservability({
        status: "finished",
        startedAt: 1.5,
        timeline: [],
      }),
    ).toBeNull();
  });

  it("parses a fully-populated timeline step", () => {
    const step = makeTimelineStep({ stepNumber: 3, finishReason: "tool-calls" });
    const result = parseAgentObservability(
      makeObservability({ timeline: [step] }),
    );
    expect(result?.timeline[0]).toEqual(step);
  });
});

// ---------------------------------------------------------------------------
// getMessageTimestamp
// ---------------------------------------------------------------------------

describe("getMessageTimestamp", () => {
  it("prefers createdAt over startedAt", () => {
    expect(getMessageTimestamp({ createdAt: 111, startedAt: 222 })).toBe(111);
  });

  it("falls back to startedAt when createdAt is absent", () => {
    expect(getMessageTimestamp({ startedAt: 222 })).toBe(222);
  });

  it("returns createdAt even when it is 0", () => {
    expect(getMessageTimestamp({ createdAt: 0, startedAt: 222 })).toBe(0);
  });

  it("ignores a non-numeric createdAt and uses startedAt", () => {
    expect(getMessageTimestamp({ createdAt: "111", startedAt: 222 })).toBe(222);
  });

  it("returns null when neither field is a number", () => {
    expect(getMessageTimestamp({ createdAt: "x", startedAt: "y" })).toBeNull();
    expect(getMessageTimestamp({})).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(getMessageTimestamp(null)).toBeNull();
    expect(getMessageTimestamp(undefined)).toBeNull();
    expect(getMessageTimestamp(123)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isInterruptedMessage
// ---------------------------------------------------------------------------

describe("isInterruptedMessage", () => {
  it("returns true only for interrupted === true", () => {
    expect(isInterruptedMessage({ interrupted: true })).toBe(true);
  });

  it("returns false for a truthy-but-not-true interrupted value", () => {
    expect(isInterruptedMessage({ interrupted: 1 })).toBe(false);
    expect(isInterruptedMessage({ interrupted: "true" })).toBe(false);
  });

  it("returns false when interrupted is false or absent", () => {
    expect(isInterruptedMessage({ interrupted: false })).toBe(false);
    expect(isInterruptedMessage({})).toBe(false);
  });

  it("returns false for non-object input", () => {
    expect(isInterruptedMessage(null)).toBe(false);
    expect(isInterruptedMessage(undefined)).toBe(false);
    expect(isInterruptedMessage("interrupted")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// finalizeInterruptedMessage — early returns
// ---------------------------------------------------------------------------

describe("finalizeInterruptedMessage — non-assistant / no-op", () => {
  it("returns a non-assistant message unchanged (same reference)", () => {
    const message = makeMessage(
      [toolPart({ type: "dynamic-tool", toolName: "x", toolCallId: "t1", state: "input-streaming" })],
      { status: "streaming", startedAt: 0, timeline: [] },
      "user",
    );
    expect(finalizeInterruptedMessage(message)).toBe(message);
  });

  it("returns the same reference when nothing needs settling and status is not streaming", () => {
    const message = makeMessage(
      [
        textPart("done"),
        toolPart({
          type: "dynamic-tool",
          toolName: "x",
          toolCallId: "t1",
          state: "output-available",
          input: {},
          output: { ok: true },
        }),
      ],
      makeObservability({ status: "finished" }),
    );
    expect(finalizeInterruptedMessage(message)).toBe(message);
  });

  it("returns the same reference when metadata is not valid observability and parts are clean", () => {
    const message = makeMessage([textPart("hello")], { createdAt: 5 });
    expect(finalizeInterruptedMessage(message)).toBe(message);
  });

  it("leaves terminal tool states untouched and returns same reference", () => {
    const message = makeMessage([
      toolPart({
        type: "dynamic-tool",
        toolName: "x",
        toolCallId: "t1",
        state: "output-error",
        input: {},
        errorText: "boom",
      }),
      toolPart({
        type: "dynamic-tool",
        toolName: "y",
        toolCallId: "t2",
        state: "approval-requested",
        input: {},
        approval: { id: "a1" },
      }),
    ]);
    expect(finalizeInterruptedMessage(message)).toBe(message);
  });

  it("leaves a tool part WITHOUT a state field untouched (state-in guard)", () => {
    // settleInterruptedToolParts only touches parts that have a `state`
    // property, so a stateless tool part falls through unchanged.
    const message = makeMessage([
      toolPart({ type: "tool-bash", toolCallId: "t1" }),
    ]);
    expect(finalizeInterruptedMessage(message)).toBe(message);
  });

  it("leaves a non-tool part carrying a stray state field untouched", () => {
    // A part whose type is neither `dynamic-tool` nor `tool-*` is never a tool
    // part, even if it happens to carry a `state` value, so it is left alone.
    const message = makeMessage([
      toolPart({ type: "reasoning", text: "thinking", state: "input-streaming" }),
    ]);
    const result = finalizeInterruptedMessage(message);
    expect(result).toBe(message);
    expect(result.parts).toHaveLength(1);
  });

  it("leaves an output-available dynamic tool part untouched", () => {
    const message = makeMessage([
      toolPart({
        type: "dynamic-tool",
        toolName: "x",
        toolCallId: "t1",
        state: "output-available",
        input: {},
        output: { ok: true },
      }),
    ]);
    expect(finalizeInterruptedMessage(message)).toBe(message);
  });
});

// ---------------------------------------------------------------------------
// finalizeInterruptedMessage — settling dangling tool parts
// (status not streaming, so metadata is untouched, only parts settle)
// ---------------------------------------------------------------------------

describe("finalizeInterruptedMessage — settling tool parts", () => {
  it("drops an input-streaming tool part", () => {
    const message = makeMessage([
      textPart("keep me"),
      toolPart({
        type: "dynamic-tool",
        toolName: "x",
        toolCallId: "t1",
        state: "input-streaming",
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    expect(result).not.toBe(message);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual(textPart("keep me"));
  });

  it("drops an AskUserQuestion part that is still input-streaming", () => {
    const message = makeMessage([
      toolPart({
        type: ASK_USER_QUESTION_PART_TYPE,
        toolCallId: "t1",
        state: "input-streaming",
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    expect(result.parts).toHaveLength(0);
  });

  it("settles a non-question input-available part to output-error with errorText", () => {
    const message = makeMessage([
      toolPart({
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "t1",
        state: "input-available",
        input: { cmd: "ls" },
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    const part = result.parts[0] as { state: string; errorText: string; input: unknown };
    expect(part.state).toBe("output-error");
    expect(part.errorText).toBe("执行被中断，未返回结果。");
    expect(part.input).toEqual({ cmd: "ls" });
  });

  it("keeps an AskUserQuestion part in input-available untouched", () => {
    const askPart = toolPart({
      type: ASK_USER_QUESTION_PART_TYPE,
      toolCallId: "t1",
      state: "input-available",
      input: { question: "?" },
    });
    const message = makeMessage([askPart]);
    const result = finalizeInterruptedMessage(message);
    // Nothing else changed, and the question part stays input-available, so the
    // whole message is returned by reference.
    expect(result).toBe(message);
    expect(result.parts[0]).toBe(askPart);
  });

  it("settles approval-responded (approved) with no output to output-error", () => {
    const message = makeMessage([
      toolPart({
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "t1",
        state: "approval-responded",
        input: {},
        approval: { id: "a1", approved: true },
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    const part = result.parts[0] as { state: string; errorText: string };
    expect(part.state).toBe("output-error");
    expect(part.errorText).toBe("已批准但执行被中断，未返回结果。");
  });

  it("settles approval-responded with approved undefined to output-error (not denied)", () => {
    // approval.approved is not === false, so it takes the approved/error branch.
    const message = makeMessage([
      toolPart({
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "t1",
        state: "approval-responded",
        input: {},
        approval: { id: "a1" },
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    const part = result.parts[0] as { state: string };
    expect(part.state).toBe("output-error");
  });

  it("settles approval-responded (denied) with no output to output-denied", () => {
    const message = makeMessage([
      toolPart({
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "t1",
        state: "approval-responded",
        input: {},
        approval: { id: "a1", approved: false },
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    const part = result.parts[0] as { state: string; errorText?: string };
    expect(part.state).toBe("output-denied");
    expect(part.errorText).toBeUndefined();
  });

  it("keeps an approval-responded part that already has output", () => {
    const respondedPart = toolPart({
      type: "dynamic-tool",
      toolName: "bash",
      toolCallId: "t1",
      state: "approval-responded",
      input: {},
      output: { done: true },
      approval: { id: "a1", approved: true },
    });
    const message = makeMessage([respondedPart]);
    const result = finalizeInterruptedMessage(message);
    expect(result).toBe(message);
    expect(result.parts[0]).toBe(respondedPart);
  });

  it("keeps a DENIED approval-responded part that already has output", () => {
    // The "has output" guard runs before the approved/denied branch, so even a
    // denied part with output is left alone (not downgraded to output-denied).
    const respondedPart = toolPart({
      type: "dynamic-tool",
      toolName: "bash",
      toolCallId: "t1",
      state: "approval-responded",
      input: {},
      output: { done: true },
      approval: { id: "a1", approved: false },
    });
    const message = makeMessage([respondedPart]);
    const result = finalizeInterruptedMessage(message);
    expect(result).toBe(message);
    expect(result.parts[0]).toBe(respondedPart);
  });

  it("settles approval-responded with an explicit output:undefined to output-error", () => {
    // `"output" in part` is true but `part.output !== undefined` is false, so
    // this still counts as "no output" and settles via the approved branch.
    const message = makeMessage([
      toolPart({
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "t1",
        state: "approval-responded",
        input: {},
        output: undefined,
        approval: { id: "a1", approved: true },
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    expect(result).not.toBe(message);
    expect((result.parts[0] as { state: string }).state).toBe("output-error");
  });

  it("settles an AskUserQuestion stuck in input-streaming by dropping it", () => {
    // The question exception only applies to input-available; in input-streaming
    // an AskUserQuestion is dropped like any other tool part.
    const message = makeMessage([
      toolPart({
        type: ASK_USER_QUESTION_PART_TYPE,
        toolCallId: "t1",
        state: "input-streaming",
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    expect(result.parts).toHaveLength(0);
  });

  it("settles an AskUserQuestion stuck in approval-responded (no output) to output-error", () => {
    // The question exception is scoped to input-available only, so an
    // AskUserQuestion in approval-responded is settled like any other tool.
    const message = makeMessage([
      toolPart({
        type: ASK_USER_QUESTION_PART_TYPE,
        toolCallId: "t1",
        state: "approval-responded",
        input: { question: "?" },
        approval: { id: "a1", approved: true },
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    expect(result).not.toBe(message);
    expect((result.parts[0] as { state: string }).state).toBe("output-error");
  });

  it("settles other parts while keeping an input-available AskUserQuestion (new reference)", () => {
    // The question part stays, but the dangling bash part settles, so the array
    // changes and a NEW message reference is returned.
    const askPart = toolPart({
      type: ASK_USER_QUESTION_PART_TYPE,
      toolCallId: "tq",
      state: "input-available",
      input: { question: "?" },
    });
    const message = makeMessage([
      askPart,
      toolPart({
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "t1",
        state: "input-available",
        input: {},
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    expect(result).not.toBe(message);
    expect(result.parts[0]).toBe(askPart);
    expect((result.parts[1] as { state: string }).state).toBe("output-error");
  });

  it("settles tool-prefixed static tool parts (not just dynamic-tool)", () => {
    const message = makeMessage([
      toolPart({
        type: "tool-bash",
        toolCallId: "t1",
        state: "input-available",
        input: {},
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    const part = result.parts[0] as { state: string };
    expect(part.state).toBe("output-error");
  });

  it("settles multiple dangling parts in one pass", () => {
    const message = makeMessage([
      toolPart({ type: "dynamic-tool", toolName: "a", toolCallId: "t1", state: "input-streaming" }),
      toolPart({
        type: "dynamic-tool",
        toolName: "b",
        toolCallId: "t2",
        state: "input-available",
        input: {},
      }),
      toolPart({
        type: "dynamic-tool",
        toolName: "c",
        toolCallId: "t3",
        state: "approval-responded",
        input: {},
        approval: { id: "a1", approved: false },
      }),
    ]);
    const result = finalizeInterruptedMessage(message);
    expect(result.parts).toHaveLength(2);
    expect((result.parts[0] as { state: string }).state).toBe("output-error");
    expect((result.parts[1] as { state: string }).state).toBe("output-denied");
  });
});

// ---------------------------------------------------------------------------
// finalizeInterruptedMessage — streaming -> finished
// ---------------------------------------------------------------------------

describe("finalizeInterruptedMessage — streaming status finalization", () => {
  it("marks a streaming message finished with interrupted:true", () => {
    const message = makeMessage(
      [textPart("partial")],
      makeObservability({
        status: "streaming",
        startedAt: 1_000,
        finishedAt: undefined,
        totalDurationMs: undefined,
        timeline: [],
      }),
    );
    const result = finalizeInterruptedMessage(message);
    expect(result).not.toBe(message);
    expect(result.metadata?.status).toBe("finished");
    expect(result.metadata?.interrupted).toBe(true);
  });

  it("uses startedAt as finishedAt when the timeline is empty", () => {
    const message = makeMessage(
      [textPart("x")],
      makeObservability({ status: "streaming", startedAt: 5_000, timeline: [] }),
    );
    const result = finalizeInterruptedMessage(message);
    expect(result.metadata?.finishedAt).toBe(5_000);
    expect(result.metadata?.totalDurationMs).toBe(0);
  });

  it("uses the max timeline finishedAt when later than startedAt", () => {
    const message = makeMessage(
      [textPart("x")],
      makeObservability({
        status: "streaming",
        startedAt: 1_000,
        timeline: [
          makeTimelineStep({ stepNumber: 0, finishedAt: 4_000 }),
          makeTimelineStep({ stepNumber: 1, finishedAt: 9_000 }),
          makeTimelineStep({ stepNumber: 2, finishedAt: 6_000 }),
        ],
      }),
    );
    const result = finalizeInterruptedMessage(message);
    expect(result.metadata?.finishedAt).toBe(9_000);
    expect(result.metadata?.totalDurationMs).toBe(8_000);
  });

  it("clamps finishedAt to startedAt when all steps finished earlier", () => {
    const message = makeMessage(
      [textPart("x")],
      makeObservability({
        status: "streaming",
        startedAt: 10_000,
        timeline: [makeTimelineStep({ finishedAt: 3_000 })],
      }),
    );
    const result = finalizeInterruptedMessage(message);
    expect(result.metadata?.finishedAt).toBe(10_000);
    expect(result.metadata?.totalDurationMs).toBe(0);
  });

  it("settles dangling parts AND finalizes metadata when streaming", () => {
    const message = makeMessage(
      [
        toolPart({
          type: "dynamic-tool",
          toolName: "bash",
          toolCallId: "t1",
          state: "input-available",
          input: {},
        }),
      ],
      makeObservability({
        status: "streaming",
        startedAt: 1_000,
        timeline: [makeTimelineStep({ finishedAt: 7_000 })],
      }),
    );
    const result = finalizeInterruptedMessage(message);
    expect((result.parts[0] as { state: string }).state).toBe("output-error");
    expect(result.metadata?.status).toBe("finished");
    expect(result.metadata?.finishedAt).toBe(7_000);
    expect(result.metadata?.totalDurationMs).toBe(6_000);
    expect(result.metadata?.interrupted).toBe(true);
  });

  it("preserves pre-existing metadata fields (e.g. createdAt) while finalizing", () => {
    const message = makeMessage([textPart("x")], {
      ...makeObservability({ status: "streaming", startedAt: 2_000, timeline: [] }),
      createdAt: 1_500,
    });
    const result = finalizeInterruptedMessage(message);
    expect(result.metadata?.createdAt).toBe(1_500);
    expect(result.metadata?.startedAt).toBe(2_000);
    expect(result.metadata?.status).toBe("finished");
  });

  it("does NOT finalize when status says streaming but metadata fails to parse", () => {
    // status === "streaming" but the rest of the observability shape is invalid
    // (no startedAt / timeline), so parseAgentObservability returns null and the
    // streaming branch is skipped entirely. Parts are clean, so the same message
    // reference is returned and the bogus status is left as-is.
    const message = makeMessage(
      [textPart("partial")],
      { status: "streaming" } as ChatMessageMetadata,
    );
    const result = finalizeInterruptedMessage(message);
    expect(result).toBe(message);
    expect(result.metadata?.status).toBe("streaming");
  });

  it("settles parts but leaves status alone when streaming metadata is unparseable", () => {
    // Invalid observability (status streaming, but no timeline) means no
    // finalization, yet dangling parts still settle, producing a new reference
    // with the bogus status preserved.
    const message = makeMessage(
      [
        toolPart({
          type: "dynamic-tool",
          toolName: "bash",
          toolCallId: "t1",
          state: "input-available",
          input: {},
        }),
      ],
      { status: "streaming", startedAt: -1 } as ChatMessageMetadata,
    );
    const result = finalizeInterruptedMessage(message);
    expect(result).not.toBe(message);
    expect((result.parts[0] as { state: string }).state).toBe("output-error");
    expect(result.metadata?.status).toBe("streaming");
    expect(result.metadata?.interrupted).toBeUndefined();
  });

  it("uses startedAt when a single timeline step finished at exactly startedAt", () => {
    const message = makeMessage(
      [textPart("x")],
      makeObservability({
        status: "streaming",
        startedAt: 5_000,
        timeline: [makeTimelineStep({ finishedAt: 5_000 })],
      }),
    );
    const result = finalizeInterruptedMessage(message);
    expect(result.metadata?.finishedAt).toBe(5_000);
    expect(result.metadata?.totalDurationMs).toBe(0);
  });

  it("does not carry stale finishedAt / totalDurationMs from streaming metadata", () => {
    // If a streaming snapshot somehow already had finishedAt/totalDurationMs,
    // finalization recomputes both from startedAt + the timeline.
    const message = makeMessage(
      [textPart("x")],
      makeObservability({
        status: "streaming",
        startedAt: 1_000,
        finishedAt: 999_999,
        totalDurationMs: 999_999,
        timeline: [makeTimelineStep({ finishedAt: 3_000 })],
      }),
    );
    const result = finalizeInterruptedMessage(message);
    expect(result.metadata?.finishedAt).toBe(3_000);
    expect(result.metadata?.totalDurationMs).toBe(2_000);
  });
});
