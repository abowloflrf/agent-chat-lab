import { describe, it, expect, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import type { ToolSet } from "ai";
import * as store from "@/lib/ai/tool-output-store";
import {
  TOOL_OUTPUT_MAX_BYTES,
  truncateMiddle,
  truncateToolOutput,
  withToolOutputLimit,
} from "@/lib/ai/truncate-output";

function utf8(text: string) {
  return Buffer.byteLength(text, "utf8");
}

describe("truncateMiddle", () => {
  it("returns short text unchanged", () => {
    expect(truncateMiddle("hello", 100)).toBe("hello");
  });

  it("keeps the head and the tail, dropping the middle", () => {
    const text = `HEAD${"x".repeat(5000)}TAIL`;
    const result = truncateMiddle(text, 500);

    expect(result.startsWith("HEAD")).toBe(true);
    expect(result.endsWith("TAIL")).toBe(true);
    expect(result).toContain("bytes truncated");
    expect(utf8(result)).toBeLessThanOrEqual(500);
  });

  it("never splits a multibyte character", () => {
    // All-CJK text: a naive byte slice would land mid-character and decode to
    // U+FFFD, the known gap the read tool still has.
    const text = "好".repeat(2000);
    const result = truncateMiddle(text, 600);

    expect(result).not.toContain("�");
    expect(utf8(result)).toBeLessThanOrEqual(600);
  });

  it("degrades to the marker alone when the budget is tiny", () => {
    const result = truncateMiddle("y".repeat(1000), 40);

    expect(result).toContain("bytes truncated");
    expect(result).not.toContain("yyyy");
  });
});

describe("truncateToolOutput", () => {
  it("passes through output already within budget", () => {
    const output = { ok: true, results: [{ url: "https://example.com" }] };
    const result = truncateToolOutput(output, { maxBytes: 1000 });

    expect(result.truncated).toBe(false);
    expect(result.value).toBe(output);
  });

  it("keeps the JSON shape and only shortens long strings", () => {
    const output = {
      ok: true,
      provider: "tavily",
      results: [{ url: "https://example.com/a", content: "z".repeat(50_000) }],
    };

    const result = truncateToolOutput(output, { maxBytes: 4000 });
    const value = result.value as typeof output & { outputTruncated: boolean };

    expect(result.truncated).toBe(true);
    expect(value.ok).toBe(true);
    // Short fields survive verbatim; only the bulky body is trimmed.
    expect(value.provider).toBe("tavily");
    expect(value.results[0].url).toBe("https://example.com/a");
    expect(value.results[0].content).toContain("bytes truncated");
    expect(utf8(JSON.stringify(value))).toBeLessThan(utf8(JSON.stringify(output)));
  });

  it("tells the model the result was shortened", () => {
    const result = truncateToolOutput({ content: "q".repeat(20_000) }, { maxBytes: 2000 });
    const value = result.value as Record<string, unknown>;

    expect(value.outputTruncated).toBe(true);
    expect(value.outputOriginalBytes).toBe(result.originalBytes);
    expect(String(value.outputTruncationNote)).toContain("tool output budget");
  });

  it("levels long strings down to a shared cap instead of dropping later ones", () => {
    const output = {
      results: [
        { content: "a".repeat(40_000) },
        { content: "b".repeat(40_000) },
        { content: "c".repeat(40_000) },
      ],
    };

    const result = truncateToolOutput(output, { maxBytes: 6000 });
    const value = result.value as typeof output;
    const sizes = value.results.map((item) => utf8(item.content));

    // Water-filling gives each oversized body an equal share, so no result is
    // starved to make room for the first one.
    expect(sizes.every((size) => size > 0)).toBe(true);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(4);
  });

  it("leaves short strings whole and only trims the oversized one", () => {
    const output = {
      short: "kept",
      alsoShort: "also kept",
      long: "L".repeat(30_000),
    };

    const value = truncateToolOutput(output, { maxBytes: 3000 }).value as typeof output;

    expect(value.short).toBe("kept");
    expect(value.alsoShort).toBe("also kept");
    expect(value.long).toContain("bytes truncated");
  });

  it("handles non-object output", () => {
    const result = truncateToolOutput("s".repeat(20_000), { maxBytes: 1000 });

    expect(result.truncated).toBe(true);
    expect(typeof result.value).toBe("string");
    expect(result.value as string).toContain("bytes truncated");
  });

  it("defaults to the shared budget", () => {
    const result = truncateToolOutput({ content: "x".repeat(TOOL_OUTPUT_MAX_BYTES * 2) });

    expect(result.truncated).toBe(true);
  });
});

describe("withToolOutputLimit", () => {
  function makeTools(execute: () => unknown): ToolSet {
    return {
      Big: { description: "d", inputSchema: {}, execute },
      // Client-side tools have no execute and must pass through untouched.
      AskUserQuestion: { description: "d", inputSchema: {} },
      Skill: { description: "d", inputSchema: {}, execute },
    } as unknown as ToolSet;
  }

  it("bounds an oversized tool result", async () => {
    const tools = withToolOutputLimit(makeTools(() => ({ content: "x".repeat(200_000) })));
    const execute = (tools.Big as { execute: (...args: unknown[]) => Promise<unknown> }).execute;

    const output = (await execute({}, {})) as Record<string, unknown>;

    expect(output.outputTruncated).toBe(true);
    expect(utf8(JSON.stringify(output))).toBeLessThan(200_000);
  });

  it("leaves a small tool result untouched", async () => {
    const original = { ok: true, value: 42 };
    const tools = withToolOutputLimit(makeTools(() => original));
    const execute = (tools.Big as { execute: (...args: unknown[]) => Promise<unknown> }).execute;

    expect(await execute({}, {})).toEqual(original);
  });

  it("exempts Skill so loaded instructions stay complete", async () => {
    const instructions = "i".repeat(200_000);
    const tools = withToolOutputLimit(makeTools(() => ({ instructions })));
    const execute = (tools.Skill as { execute: (...args: unknown[]) => Promise<unknown> }).execute;

    const output = (await execute({}, {})) as { instructions: string };

    expect(output.instructions).toBe(instructions);
  });

  it("passes through tools without execute", () => {
    const tools = makeTools(() => ({}));
    const limited = withToolOutputLimit(tools);

    expect(limited.AskUserQuestion).toBe(tools.AskUserQuestion);
  });

  it("reports truncation to the caller", async () => {
    const onTruncate = vi.fn();
    const tools = withToolOutputLimit(
      makeTools(() => ({ content: "x".repeat(200_000) })),
      onTruncate,
    );
    const execute = (tools.Big as { execute: (...args: unknown[]) => Promise<unknown> }).execute;

    await execute({}, {});

    expect(onTruncate).toHaveBeenCalledTimes(1);
    const info = onTruncate.mock.calls[0][0] as {
      toolName: string;
      originalBytes: number;
      outputBytes: number;
    };
    expect(info.toolName).toBe("Big");
    expect(info.originalBytes).toBeGreaterThan(info.outputBytes);
  });

  it("spills the full output to disk and points the model at it", async () => {
    const content = "x".repeat(200_000);
    const tools = withToolOutputLimit(makeTools(() => ({ content })));
    const execute = (tools.Big as { execute: (...args: unknown[]) => Promise<unknown> }).execute;

    const output = (await execute({}, {})) as { fullOutputPath?: string };
    const spilled = output.fullOutputPath;

    expect(spilled).toBeTruthy();
    // The spilled copy is the complete original, recoverable with the read tool.
    const saved = await readFile(spilled as string, "utf8");
    expect(JSON.parse(saved).content).toBe(content);

    await rm(spilled as string, { force: true });
  });

  it("still returns a bounded result when spilling fails", async () => {
    const spy = vi.spyOn(store, "persistToolOutput").mockResolvedValue(undefined);
    const tools = withToolOutputLimit(makeTools(() => ({ content: "x".repeat(200_000) })));
    const execute = (tools.Big as { execute: (...args: unknown[]) => Promise<unknown> }).execute;

    const output = (await execute({}, {})) as Record<string, unknown>;

    // A failed spill must not fail the tool call; it only drops the path.
    expect(output.outputTruncated).toBe(true);
    expect(output.fullOutputPath).toBeUndefined();
    spy.mockRestore();
  });
});
