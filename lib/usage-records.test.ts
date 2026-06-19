import { describe, it, expect } from "vitest";
import {
  expandMessageUsageRecords,
  buildConversationUsageRecords,
} from "@/lib/usage-records";
import { toDayKey } from "@/lib/datetime";
import type {
  AgentObservability,
  AgentTimelineStep,
  ChatUIMessage,
} from "@/lib/observability";

// A fixed point in time (2024-01-15T04:00:00Z) — well-defined under the
// pinned Asia/Shanghai timezone the datetime module uses for toDayKey.
const BASE_TS = Date.UTC(2024, 0, 15, 4, 0, 0);

function makeStep(
  overrides: Partial<AgentTimelineStep> = {},
): AgentTimelineStep {
  return {
    event: "step-finish",
    stepNumber: 0,
    startedAt: BASE_TS,
    finishedAt: BASE_TS + 1000,
    durationMs: 1000,
    finishReason: "stop",
    provider: "openai",
    modelId: "gpt-4o",
    text: "hello",
    toolCalls: [],
    toolResults: [],
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      reasoningTokens: 5,
      cachedInputTokens: 2,
    },
    ...overrides,
  };
}

function makeObservability(
  overrides: Partial<AgentObservability> = {},
): AgentObservability {
  return {
    status: "finished",
    startedAt: BASE_TS,
    finishedAt: BASE_TS + 2000,
    totalDurationMs: 2000,
    timeline: [makeStep()],
    ...overrides,
  };
}

function makeAssistantMessage(
  id: string,
  metadata: ChatUIMessage["metadata"],
): ChatUIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text: "hi" }],
    metadata,
  };
}

function makeUserMessage(id: string): ChatUIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text: "ask" }],
  };
}

describe("expandMessageUsageRecords — invalid metadata", () => {
  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["a string", "nope"],
    ["an empty object (missing required fields)", {}],
    ["object missing timeline", { status: "finished", startedAt: BASE_TS }],
    [
      "object with wrong status enum",
      { status: "done", startedAt: BASE_TS, timeline: [] },
    ],
    [
      "a step with a non-step-finish event",
      {
        status: "finished",
        startedAt: BASE_TS,
        timeline: [{ ...makeStep(), event: "step-start" }],
      },
    ],
    [
      "a step with a negative startedAt",
      makeObservability({ timeline: [makeStep({ startedAt: -1 })] }),
    ],
    [
      "a step whose usage is missing a field",
      {
        status: "finished",
        startedAt: BASE_TS,
        timeline: [
          {
            ...makeStep(),
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          },
        ],
      },
    ],
    [
      "a step with a negative stepNumber",
      makeObservability({ timeline: [makeStep({ stepNumber: -1 })] }),
    ],
    [
      "a step with a non-integer startedAt",
      makeObservability({ timeline: [makeStep({ startedAt: BASE_TS + 0.5 })] }),
    ],
    [
      "a step with a negative token count in usage",
      {
        status: "finished",
        startedAt: BASE_TS,
        timeline: [
          {
            ...makeStep(),
            usage: {
              inputTokens: -1,
              outputTokens: 2,
              totalTokens: 3,
              reasoningTokens: 4,
              cachedInputTokens: 5,
            },
          },
        ],
      },
    ],
    [
      "a step missing the required text field",
      {
        status: "finished",
        startedAt: BASE_TS,
        timeline: [(() => {
          const { text: _omit, ...rest } = makeStep();
          void _omit;
          return rest;
        })()],
      },
    ],
    [
      "an object whose startedAt is a string",
      { status: "finished", startedAt: "2024", timeline: [] },
    ],
    [
      "an object whose timeline is not an array",
      { status: "finished", startedAt: BASE_TS, timeline: makeStep() },
    ],
  ])("returns [] for %s", (_label, metadata) => {
    expect(expandMessageUsageRecords("conv-1", "msg-1", metadata)).toEqual([]);
  });
});

describe("expandMessageUsageRecords — valid metadata", () => {
  it("returns an empty array when the timeline is empty (no steps)", () => {
    const metadata = makeObservability({ timeline: [] });
    expect(expandMessageUsageRecords("conv-1", "msg-1", metadata)).toEqual([]);
  });

  it("maps a single step into one fully-populated seed row", () => {
    const step = makeStep({
      stepNumber: 3,
      provider: "anthropic",
      modelId: "claude-3-5-sonnet",
      finishReason: "tool-calls",
      durationMs: 1234,
      startedAt: BASE_TS,
      finishedAt: BASE_TS + 1234,
      toolCalls: [
        { toolCallId: "t1", toolName: "Bash" },
        { toolCallId: "t2", toolName: "Read" },
      ],
      usage: {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        reasoningTokens: 50,
        cachedInputTokens: 25,
      },
    });
    const metadata = makeObservability({ timeline: [step] });

    const rows = expandMessageUsageRecords("conv-7", "msg-9", metadata);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      conversationId: "conv-7",
      messageId: "msg-9",
      stepNumber: 3,
      provider: "anthropic",
      modelId: "claude-3-5-sonnet",
      finishReason: "tool-calls",
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      reasoningTokens: 50,
      cachedInputTokens: 25,
      durationMs: 1234,
      toolCallCount: 2,
      startedAt: BASE_TS,
      finishedAt: BASE_TS + 1234,
      dayKey: toDayKey(BASE_TS),
    });
  });

  it("emits exactly the insert columns (no id, no extra keys)", () => {
    const rows = expandMessageUsageRecords("c", "m", makeObservability());
    expect(rows).toHaveLength(1);
    // The seed is Omit<usageRecords.$inferInsert, "id"> — pin the exact key set
    // so a column added/removed in the schema mapping is caught.
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        "cachedInputTokens",
        "conversationId",
        "dayKey",
        "durationMs",
        "finishReason",
        "finishedAt",
        "inputTokens",
        "messageId",
        "modelId",
        "outputTokens",
        "provider",
        "reasoningTokens",
        "startedAt",
        "stepNumber",
        "toolCallCount",
        "totalTokens",
      ].sort(),
    );
    expect("id" in rows[0]).toBe(false);
  });

  it("carries startedAt and finishedAt through independently", () => {
    const started = Date.UTC(2024, 5, 1, 2, 0, 0);
    const finished = Date.UTC(2024, 5, 1, 9, 0, 0);
    const step = makeStep({
      startedAt: started,
      finishedAt: finished,
      durationMs: finished - started,
    });
    const rows = expandMessageUsageRecords(
      "c",
      "m",
      makeObservability({ timeline: [step] }),
    );
    expect(rows[0].startedAt).toBe(started);
    expect(rows[0].finishedAt).toBe(finished);
    // dayKey is derived from startedAt, never finishedAt.
    expect(rows[0].dayKey).toBe(toDayKey(started));
  });

  it("derives toolCallCount from toolCalls.length, not toolResults", () => {
    const step = makeStep({
      toolCalls: [
        { toolCallId: "a", toolName: "X" },
        { toolCallId: "b", toolName: "Y" },
        { toolCallId: "c", toolName: "Z" },
      ],
      // toolResults intentionally a different length — must be ignored.
      toolResults: [{ toolCallId: "a", toolName: "X" }],
    });
    const rows = expandMessageUsageRecords(
      "c",
      "m",
      makeObservability({ timeline: [step] }),
    );
    expect(rows[0].toolCallCount).toBe(3);
  });

  it("computes dayKey via toDayKey(step.startedAt) in Asia/Shanghai", () => {
    // 2024-01-15T16:30:00Z is 2024-01-16 00:30 in Asia/Shanghai (UTC+8),
    // so the dayKey must roll over to the next calendar day.
    const lateUtc = Date.UTC(2024, 0, 15, 16, 30, 0);
    const step = makeStep({
      startedAt: lateUtc,
      finishedAt: lateUtc + 1000,
    });
    const rows = expandMessageUsageRecords(
      "c",
      "m",
      makeObservability({ timeline: [step] }),
    );
    expect(rows[0].dayKey).toBe(toDayKey(lateUtc));
    expect(rows[0].dayKey).toBe(20240116);
  });

  it("dayKey tracks each step's own startedAt, not the message startedAt", () => {
    const day1 = Date.UTC(2024, 2, 1, 4, 0, 0);
    const day2 = Date.UTC(2024, 2, 2, 4, 0, 0);
    const metadata = makeObservability({
      startedAt: day1,
      timeline: [
        makeStep({ stepNumber: 0, startedAt: day1, finishedAt: day1 + 10 }),
        makeStep({ stepNumber: 1, startedAt: day2, finishedAt: day2 + 10 }),
      ],
    });

    const rows = expandMessageUsageRecords("c", "m", metadata);
    expect(rows.map((r) => r.dayKey)).toEqual([toDayKey(day1), toDayKey(day2)]);
  });

  it("emits one row per timeline step, preserving order", () => {
    const metadata = makeObservability({
      timeline: [
        makeStep({ stepNumber: 0, modelId: "m0" }),
        makeStep({ stepNumber: 1, modelId: "m1" }),
        makeStep({ stepNumber: 2, modelId: "m2" }),
      ],
    });

    const rows = expandMessageUsageRecords("conv", "msg", metadata);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.stepNumber)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.modelId)).toEqual(["m0", "m1", "m2"]);
    // conversationId/messageId are stamped on every row.
    expect(rows.every((r) => r.conversationId === "conv")).toBe(true);
    expect(rows.every((r) => r.messageId === "msg")).toBe(true);
  });

  it("parses successfully when optional observability fields are absent", () => {
    // finishedAt / totalDurationMs are optional in the schema.
    const metadata: unknown = {
      status: "streaming",
      startedAt: BASE_TS,
      timeline: [makeStep()],
    };
    const rows = expandMessageUsageRecords("c", "m", metadata);
    expect(rows).toHaveLength(1);
    expect(rows[0].stepNumber).toBe(0);
  });

  it("ignores unknown extra metadata keys (createdAt / interrupted)", () => {
    const metadata = {
      ...makeObservability(),
      createdAt: 999,
      interrupted: true,
    };
    const rows = expandMessageUsageRecords("c", "m", metadata);
    expect(rows).toHaveLength(1);
  });

  it("supports zero-valued usage and duration", () => {
    const step = makeStep({
      durationMs: 0,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
      },
    });
    const rows = expandMessageUsageRecords(
      "c",
      "m",
      makeObservability({ timeline: [step] }),
    );
    expect(rows[0].inputTokens).toBe(0);
    expect(rows[0].durationMs).toBe(0);
    expect(rows[0].toolCallCount).toBe(0);
  });
});

describe("buildConversationUsageRecords", () => {
  it("returns [] for an empty conversation", () => {
    expect(buildConversationUsageRecords("conv", [])).toEqual([]);
  });

  it("ignores user messages entirely", () => {
    const messages: ChatUIMessage[] = [
      makeUserMessage("u1"),
      makeUserMessage("u2"),
    ];
    expect(buildConversationUsageRecords("conv", messages)).toEqual([]);
  });

  it("ignores assistant messages whose metadata is invalid/absent", () => {
    const messages: ChatUIMessage[] = [
      makeAssistantMessage("a-no-meta", undefined),
      makeAssistantMessage("a-bad-meta", {
        createdAt: 1,
      } as ChatUIMessage["metadata"]),
    ];
    expect(buildConversationUsageRecords("conv", messages)).toEqual([]);
  });

  it("flatMaps per-step rows across multiple assistant messages", () => {
    const a1 = makeAssistantMessage(
      "a1",
      makeObservability({
        timeline: [
          makeStep({ stepNumber: 0, modelId: "a1-s0" }),
          makeStep({ stepNumber: 1, modelId: "a1-s1" }),
        ],
      }),
    );
    const a2 = makeAssistantMessage(
      "a2",
      makeObservability({ timeline: [makeStep({ stepNumber: 0, modelId: "a2-s0" })] }),
    );

    const messages: ChatUIMessage[] = [
      makeUserMessage("u1"),
      a1,
      makeUserMessage("u2"),
      a2,
    ];

    const rows = buildConversationUsageRecords("conv-x", messages);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.modelId)).toEqual(["a1-s0", "a1-s1", "a2-s0"]);
    // messageId is taken from each assistant message's own id.
    expect(rows.map((r) => r.messageId)).toEqual(["a1", "a1", "a2"]);
    expect(rows.every((r) => r.conversationId === "conv-x")).toBe(true);
  });

  it("threads the conversationId argument (not anything from the messages)", () => {
    const a1 = makeAssistantMessage("a1", makeObservability());
    const rows = buildConversationUsageRecords("the-conv-id", [a1]);
    expect(rows).toHaveLength(1);
    expect(rows[0].conversationId).toBe("the-conv-id");
  });

  it("skips an assistant message with an empty timeline among valid ones", () => {
    const empty = makeAssistantMessage(
      "empty",
      makeObservability({ timeline: [] }),
    );
    const full = makeAssistantMessage("full", makeObservability());
    const rows = buildConversationUsageRecords("conv", [empty, full]);
    expect(rows).toHaveLength(1);
    expect(rows[0].messageId).toBe("full");
  });

  it("skips an invalid assistant message but keeps valid ones around it", () => {
    const before = makeAssistantMessage(
      "before",
      makeObservability({ timeline: [makeStep({ modelId: "before-s0" })] }),
    );
    const invalid = makeAssistantMessage("invalid", {
      createdAt: 1,
    } as ChatUIMessage["metadata"]);
    const after = makeAssistantMessage(
      "after",
      makeObservability({ timeline: [makeStep({ modelId: "after-s0" })] }),
    );

    const rows = buildConversationUsageRecords("conv", [before, invalid, after]);
    expect(rows.map((r) => r.messageId)).toEqual(["before", "after"]);
    expect(rows.map((r) => r.modelId)).toEqual(["before-s0", "after-s0"]);
  });

  it("does not treat a system message as a contributor", () => {
    const system: ChatUIMessage = {
      id: "s1",
      role: "system",
      parts: [{ type: "text", text: "sys" }],
      // Even with valid-looking metadata, only role === 'assistant' contributes.
      metadata: makeObservability(),
    };
    expect(buildConversationUsageRecords("conv", [system])).toEqual([]);
  });
});
