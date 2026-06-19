import { describe, it, expect } from "vitest";
import type { TextStreamPart, ToolSet } from "ai";
import { createOpenAICompatibleChatReasoningTransform } from "@/lib/ai/chat-reasoning-transform";

type Part = TextStreamPart<ToolSet>;

/**
 * Build the transform stream for one run. The factory ignores its options at
 * runtime, so a minimal stub satisfies the StreamTextTransform signature.
 */
function makeTransform() {
  const factory = createOpenAICompatibleChatReasoningTransform<ToolSet>();
  return factory({ tools: {} as ToolSet, stopStream: () => {} });
}

/** Pump an ordered list of parts through the transform and collect the output. */
async function run(parts: Part[]): Promise<Part[]> {
  const ts = makeTransform();
  const readable = new ReadableStream<Part>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });

  const out: Part[] = [];
  for await (const part of readable.pipeThrough(ts)) {
    out.push(part);
  }
  return out;
}

/** Just the ordered list of part `type`s, for concise assertions. */
const types = (parts: Part[]): string[] => parts.map((p) => p.type);

// ---- Typed fixture builders -------------------------------------------------

/**
 * A raw OpenAI-compatible chunk. `rawValue` is left as `unknown` so callers can
 * pass either an object or a JSON string (the module's parseRawValue handles
 * both).
 */
function rawPart(rawValue: unknown): Part {
  return { type: "raw", rawValue };
}

function reasoningChunk(reasoningContent: string): Record<string, unknown> {
  return { choices: [{ delta: { reasoning_content: reasoningContent } }] };
}

function textDelta(text: string, id = "txt-0"): Part {
  return { type: "text-delta", id, text };
}

/** Cast a minimal object through `unknown` for part shapes with heavy fields. */
function asPart(value: Record<string, unknown>): Part {
  return value as unknown as Part;
}

// Helper to read the text out of a reasoning-delta without `any`.
function reasoningDeltaText(part: Part): string {
  if (part.type !== "reasoning-delta") {
    throw new Error(`expected reasoning-delta, got ${part.type}`);
  }
  return part.text;
}

describe("createOpenAICompatibleChatReasoningTransform — raw reasoning extraction", () => {
  // Note: when reasoning is the last thing in the stream, flush() appends a
  // trailing reasoning-end. These single-raw cases therefore end with one.
  it("emits reasoning-start, reasoning-delta, then the raw part for an object rawValue", async () => {
    const out = await run([rawPart(reasoningChunk("thinking..."))]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "reasoning-end",
    ]);
    expect(reasoningDeltaText(out[1])).toBe("thinking...");
  });

  it("parses a JSON STRING rawValue the same as an object", async () => {
    const json = JSON.stringify(reasoningChunk("string-reasoning"));
    const out = await run([rawPart(json)]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "reasoning-end",
    ]);
    expect(reasoningDeltaText(out[1])).toBe("string-reasoning");
  });

  it("reads camelCase reasoningContent as well", async () => {
    const out = await run([
      rawPart({ choices: [{ delta: { reasoningContent: "camel" } }] }),
    ]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "reasoning-end",
    ]);
    expect(reasoningDeltaText(out[1])).toBe("camel");
  });

  it("reads reasoning_content from message (non-delta) shape", async () => {
    const out = await run([
      rawPart({ choices: [{ message: { reasoning_content: "from-message" } }] }),
    ]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "reasoning-end",
    ]);
    expect(reasoningDeltaText(out[1])).toBe("from-message");
  });

  it("concatenates reasoning content across multiple choices", async () => {
    const out = await run([
      rawPart({
        choices: [
          { delta: { reasoning_content: "a" } },
          { delta: { reasoning_content: "b" } },
        ],
      }),
    ]);

    expect(reasoningDeltaText(out[1])).toBe("ab");
  });

  it("keeps a single open reasoning across consecutive raw chunks (no re-start)", async () => {
    const out = await run([
      rawPart(reasoningChunk("part1 ")),
      rawPart(reasoningChunk("part2")),
    ]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "reasoning-delta", // same open reasoning, no second reasoning-start
      "raw",
      "reasoning-end", // flush closes the still-open block
    ]);
    expect(reasoningDeltaText(out[1])).toBe("part1 ");
    expect(reasoningDeltaText(out[3])).toBe("part2");
  });

  it("passes through a raw part with no reasoning content untouched", async () => {
    const out = await run([rawPart({ choices: [{ delta: { content: "hi" } }] })]);
    expect(types(out)).toEqual(["raw"]);
  });

  it("ignores empty-string reasoning_content (no reasoning opened)", async () => {
    const out = await run([rawPart(reasoningChunk(""))]);
    expect(types(out)).toEqual(["raw"]);
  });

  it("treats an unparseable JSON string rawValue as having no reasoning", async () => {
    const out = await run([rawPart("{not valid json")]);
    expect(types(out)).toEqual(["raw"]);
  });

  it("treats a non-record parsed rawValue (array/number) as having no reasoning", async () => {
    const out = await run([rawPart("[1,2,3]"), rawPart(42)]);
    expect(types(out)).toEqual(["raw", "raw"]);
  });

  it("treats null / undefined rawValue as having no reasoning", async () => {
    // parseRawValue returns the value unchanged for non-strings; isRecord(null)
    // and isRecord(undefined) are both false, so no reasoning is synthesized.
    const out = await run([rawPart(null), rawPart(undefined)]);
    expect(types(out)).toEqual(["raw", "raw"]);
  });

  it("treats a record rawValue with no choices array as having no reasoning", async () => {
    // No `choices` key → choices defaults to [] → joined "".
    const out = await run([rawPart({ id: "abc", object: "chat.completion" })]);
    expect(types(out)).toEqual(["raw"]);
  });

  it("treats a non-array choices field as having no reasoning", async () => {
    // choices is a string, not an array → Array.isArray() false → [] → "".
    const out = await run([rawPart({ choices: "not-an-array" })]);
    expect(types(out)).toEqual(["raw"]);
  });

  it("ignores non-record choice entries (null / number) within the array", async () => {
    // extractReasoningContentFromChoice returns "" for non-record choices, so
    // only the well-formed choice contributes its reasoning text.
    const out = await run([
      rawPart({
        choices: [
          null,
          7,
          { delta: { reasoning_content: "only-this" } },
        ],
      }),
    ]);
    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "reasoning-end",
    ]);
    expect(reasoningDeltaText(out[1])).toBe("only-this");
  });

  it("ignores a non-string reasoning_content value (number)", async () => {
    // firstStringField only accepts string values, so a numeric
    // reasoning_content yields no reasoning text.
    const out = await run([
      rawPart({ choices: [{ delta: { reasoning_content: 123 } }] }),
    ]);
    expect(types(out)).toEqual(["raw"]);
  });

  it("prefers delta reasoning over message reasoning within a choice", async () => {
    // extractReasoningContentFromChoice returns the delta value first; the
    // message field is only consulted when the delta value is empty.
    const out = await run([
      rawPart({
        choices: [
          {
            delta: { reasoning_content: "from-delta" },
            message: { reasoning_content: "from-message" },
          },
        ],
      }),
    ]);
    expect(reasoningDeltaText(out[1])).toBe("from-delta");
  });

  it("falls back to message reasoning when delta reasoning is empty", async () => {
    // delta has an empty reasoning_content (skipped by length>0), so the
    // `||` falls through to the message field.
    const out = await run([
      rawPart({
        choices: [
          {
            delta: { reasoning_content: "" },
            message: { reasoning_content: "from-message" },
          },
        ],
      }),
    ]);
    expect(reasoningDeltaText(out[1])).toBe("from-message");
  });

  it("prefers reasoning_content over reasoningContent within a record", async () => {
    // firstStringField checks keys in order: snake_case first.
    const out = await run([
      rawPart({
        choices: [
          { delta: { reasoning_content: "snake", reasoningContent: "camel" } },
        ],
      }),
    ]);
    expect(reasoningDeltaText(out[1])).toBe("snake");
  });

  it("falls back to reasoningContent when reasoning_content is empty", async () => {
    // snake_case present but empty → skipped → camelCase used.
    const out = await run([
      rawPart({
        choices: [
          { delta: { reasoning_content: "", reasoningContent: "camel" } },
        ],
      }),
    ]);
    expect(reasoningDeltaText(out[1])).toBe("camel");
  });
});

describe("createOpenAICompatibleChatReasoningTransform — closing on text", () => {
  it("a non-empty text-delta closes reasoning (reasoning-end before the text)", async () => {
    const out = await run([
      rawPart(reasoningChunk("thinking")),
      textDelta("answer"),
    ]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "reasoning-end",
      "text-delta",
    ]);
  });

  it("an empty text-delta with no open reasoning just passes through", async () => {
    // shouldCloseReasoningBefore returns false for an empty text-delta and
    // there is nothing to close, so the part is emitted unchanged.
    const out = await run([textDelta("")]);
    expect(types(out)).toEqual(["text-delta"]);
  });

  it("an EMPTY text-delta (text:\"\") does NOT close reasoning", async () => {
    const out = await run([
      rawPart(reasoningChunk("thinking")),
      textDelta(""), // placeholder content during the reasoning phase
      rawPart(reasoningChunk(" more")),
      textDelta("answer"),
    ]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "text-delta", // empty delta passes through, reasoning stays open
      "reasoning-delta", // reasoning continues in the same block
      "raw",
      "reasoning-end", // only the non-empty text-delta closes it
      "text-delta",
    ]);
    expect(reasoningDeltaText(out[1])).toBe("thinking");
    expect(reasoningDeltaText(out[4])).toBe(" more");
  });
});

describe("createOpenAICompatibleChatReasoningTransform — boundary parts do not close reasoning", () => {
  it("raw / start / start-step / text-start / text-end keep reasoning open", async () => {
    const out = await run([
      rawPart(reasoningChunk("r")),
      asPart({ type: "start" }),
      asPart({ type: "start-step", request: {}, warnings: [] }),
      asPart({ type: "text-start", id: "txt-0" }),
      asPart({ type: "text-end", id: "txt-0" }),
      rawPart(reasoningChunk("still-open")),
    ]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "start",
      "start-step",
      "text-start",
      "text-end",
      "reasoning-delta", // same block: none of the boundaries closed it
      "raw",
      "reasoning-end", // only flush closes it at end of stream
    ]);
    // The single reasoning-end is the flush one (last element); none of the
    // boundary parts produced an earlier reasoning-end.
    expect(types(out.slice(0, -1))).not.toContain("reasoning-end");
  });
});

describe("createOpenAICompatibleChatReasoningTransform — non-boundary parts close reasoning", () => {
  it.each([
    ["finish-step", { type: "finish-step" }],
    ["finish", { type: "finish" }],
    ["error", { type: "error", error: new Error("x") }],
    ["abort", { type: "abort" }],
    ["tool-call", { type: "tool-call" }],
    ["source", { type: "source" }],
    ["file", { type: "file" }],
  ])("a %s part closes reasoning before being enqueued", async (_name, part) => {
    const out = await run([rawPart(reasoningChunk("r")), asPart(part)]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "reasoning-end",
      part.type,
    ]);
  });

  it("does nothing extra if there is no open reasoning when a closing part arrives", async () => {
    const out = await run([asPart({ type: "finish" })]);
    expect(types(out)).toEqual(["finish"]);
  });
});

describe("createOpenAICompatibleChatReasoningTransform — native reasoning parts", () => {
  it("passes native reasoning-start/-delta/-end straight through", async () => {
    const out = await run([
      asPart({ type: "reasoning-start", id: "n-0" }),
      asPart({ type: "reasoning-delta", id: "n-0", text: "native" }),
      asPart({ type: "reasoning-end", id: "n-0" }),
    ]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
    ]);
    expect(reasoningDeltaText(out[1])).toBe("native");
  });

  it("a native reasoning part sets the latch so later raw chunks are NOT scanned", async () => {
    const out = await run([
      asPart({ type: "reasoning-start", id: "n-0" }),
      asPart({ type: "reasoning-delta", id: "n-0", text: "native" }),
      asPart({ type: "reasoning-end", id: "n-0" }),
      // After native reasoning, raw chunks with reasoning_content are ignored.
      rawPart(reasoningChunk("should-be-ignored")),
    ]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "raw", // raw passed through without synthesizing reasoning
    ]);
  });

  it("a native reasoning part closes a synthesized reasoning block first", async () => {
    const out = await run([
      rawPart(reasoningChunk("synth")),
      asPart({ type: "reasoning-start", id: "n-0" }),
    ]);

    expect(types(out)).toEqual([
      "reasoning-start", // synthesized
      "reasoning-delta",
      "raw",
      "reasoning-end", // synthesized block closed before native
      "reasoning-start", // native passes through
    ]);
  });

  it("a single native reasoning-delta sets the latch (no preceding -start needed)", async () => {
    // isNativeReasoningPart matches reasoning-delta on its own, so the latch
    // flips even without a native reasoning-start. The later raw chunk is then
    // passed through unscanned.
    const out = await run([
      asPart({ type: "reasoning-delta", id: "n-0", text: "native" }),
      rawPart(reasoningChunk("ignored")),
    ]);

    expect(types(out)).toEqual(["reasoning-delta", "raw"]);
    expect(reasoningDeltaText(out[0])).toBe("native");
  });

  it("the latch persists across intervening non-reasoning parts", async () => {
    // Once nativeReasoningSeen is true it never resets, so even after a
    // text-delta the raw chunk is still not scanned for reasoning_content.
    const out = await run([
      asPart({ type: "reasoning-end", id: "n-0" }),
      textDelta("answer"),
      rawPart(reasoningChunk("still-ignored")),
    ]);

    expect(types(out)).toEqual(["reasoning-end", "text-delta", "raw"]);
  });
});

describe("createOpenAICompatibleChatReasoningTransform — flush", () => {
  it("closes an open synthesized reasoning block at end of stream", async () => {
    const out = await run([rawPart(reasoningChunk("dangling"))]);

    expect(types(out)).toEqual([
      "reasoning-start",
      "reasoning-delta",
      "raw",
      "reasoning-end", // emitted by flush()
    ]);
  });

  it("does not emit a stray reasoning-end when nothing is open", async () => {
    const out = await run([textDelta("hi")]);
    expect(types(out)).toEqual(["text-delta"]);
  });
});

describe("createOpenAICompatibleChatReasoningTransform — reasoning ids", () => {
  it("reuses one id within a block and increments across separate blocks", async () => {
    const out = await run([
      rawPart(reasoningChunk("a")), // block 0
      textDelta("answer"), // closes block 0
      rawPart(reasoningChunk("b")), // block 1
    ]);

    const startIds = out
      .filter((p) => p.type === "reasoning-start")
      .map((p) => (p as Extract<Part, { type: "reasoning-start" }>).id);

    expect(startIds).toEqual(["chat-reasoning-0", "chat-reasoning-1"]);
  });
});
