import type { ToolSet } from "ai";
import { persistToolOutput } from "@/lib/ai/tool-output-store";

const DEFAULT_TOOL_OUTPUT_MAX_BYTES = 32 * 1024;
const MIN_TOOL_OUTPUT_MAX_BYTES = 1024;

/** Read + validate the budget override, falling back to the default. */
function resolveMaxBytes(): number {
  const raw = process.env.TOOL_OUTPUT_MAX_BYTES?.trim();

  if (!raw) {
    return DEFAULT_TOOL_OUTPUT_MAX_BYTES;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < MIN_TOOL_OUTPUT_MAX_BYTES) {
    return DEFAULT_TOOL_OUTPUT_MAX_BYTES;
  }

  return parsed;
}

/**
 * Shared output budget for every tool result that enters the conversation.
 *
 * Tool results dominate context growth: unlike a system prompt they are
 * re-sent verbatim on every later turn, so one oversized result is paid for
 * again and again. Applying the budget at the tool boundary — rather than
 * inside each tool — is what makes it cover MCP servers too, which are
 * third-party and cannot be trusted to bound their own output.
 *
 * 32KB (~8k tokens) leaves the vast majority of real calls untouched while
 * capping the long tail; override with the `TOOL_OUTPUT_MAX_BYTES` env var.
 * For reference: codex truncates to 10KB, pi/tau/opencode to 50KB.
 */
export const TOOL_OUTPUT_MAX_BYTES = resolveMaxBytes();

/**
 * Tools whose output must never be trimmed.
 *
 * Skill returns a skill's full instructions, deliberately loaded on demand;
 * truncating them would silently break the workflow the model is about to
 * follow.
 */
const OUTPUT_LIMIT_EXEMPT_TOOLS = new Set(["Skill"]);

/** Smallest slice worth keeping on either side of a truncation marker. */
const MIN_SEGMENT_BYTES = 64;

function utf8Length(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** Take the first `max` bytes, backing off to a UTF-8 boundary. */
function headBytes(buffer: Buffer, max: number): Buffer {
  let end = Math.min(max, buffer.length);
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return buffer.subarray(0, end);
}

/** Take the last `max` bytes, backing off to a UTF-8 boundary. */
function tailBytes(buffer: Buffer, max: number): Buffer {
  let start = Math.max(0, buffer.length - max);
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return buffer.subarray(start);
}

/**
 * Trim the middle of a string, keeping its head and tail.
 *
 * Head and tail carry the most signal in tool output — a page's title and
 * structure, a listing's first entries, a log's final lines — while the middle
 * is the most droppable. Mirrors codex's `truncate_middle_chars`.
 */
export function truncateMiddle(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");

  if (buffer.length <= maxBytes) {
    return text;
  }

  const removed = buffer.length - maxBytes;
  const marker = `…[${removed} bytes truncated to fit the tool output budget]…`;
  const markerBytes = utf8Length(marker);
  const keep = maxBytes - markerBytes;

  // Budget too small to say anything useful alongside the marker: the marker
  // alone is more informative than a few stray bytes of content.
  if (keep < MIN_SEGMENT_BYTES * 2) {
    return marker;
  }

  const headBudget = Math.ceil(keep / 2);
  const head = headBytes(buffer, headBudget).toString("utf8");
  const tail = tailBytes(buffer, keep - headBudget).toString("utf8");

  return `${head}${marker}${tail}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === "string") {
    return fn(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => mapStrings(item, fn));
  }
  if (isPlainObject(value)) {
    const mapped: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      mapped[key] = mapStrings(item, fn);
    }
    return mapped;
  }
  return value;
}

function collectStringLengths(value: unknown, lengths: number[]): void {
  if (typeof value === "string") {
    lengths.push(utf8Length(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringLengths(item, lengths);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) {
      collectStringLengths(item, lengths);
    }
  }
}

/**
 * Largest per-string budget whose total still fits, found by water-filling:
 * short strings are left whole and only the long ones are levelled down to a
 * common cap. This is what keeps `url` / `title` / `provider` intact while a
 * result's several long `content` bodies each get an equal share.
 */
function findStringCap(lengths: number[], budget: number): number {
  const ascending = [...lengths].sort((a, b) => a - b);
  let remaining = budget;

  for (let index = 0; index < ascending.length; index += 1) {
    const cap = Math.floor(remaining / (ascending.length - index));
    if (ascending[index] > cap) {
      return cap;
    }
    remaining -= ascending[index];
  }

  return Number.POSITIVE_INFINITY;
}

function serializedLength(value: unknown): number {
  try {
    return utf8Length(JSON.stringify(value) ?? "");
  } catch {
    // Non-serializable output (cycles, BigInt) is left for the SDK to reject;
    // reporting 0 keeps it out of the truncation path.
    return 0;
  }
}

export type ToolOutputTruncation = {
  value: unknown;
  truncated: boolean;
  originalBytes: number;
};

export type TruncateToolOutputOptions = {
  maxBytes?: number;
  /** Where the untruncated output was spilled, surfaced so the model can read it back. */
  fullOutputPath?: string;
};

/** Serialize a tool result the same way the budget measures it. */
export function serializeToolOutput(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Whether a tool result needs bounding, without paying for the rewrite. */
export function exceedsToolOutputBudget(
  value: unknown,
  maxBytes: number = TOOL_OUTPUT_MAX_BYTES,
): boolean {
  return serializedLength(value) > maxBytes;
}

/**
 * Bring one tool result within `maxBytes` while keeping its JSON shape intact.
 *
 * Only string leaves are shortened — keys, numbers, and the object structure
 * survive untouched — so the model still sees a well-formed result it can
 * reason about, just with the bulky text elided.
 */
export function truncateToolOutput(
  value: unknown,
  options: TruncateToolOutputOptions = {},
): ToolOutputTruncation {
  const maxBytes = options.maxBytes ?? TOOL_OUTPUT_MAX_BYTES;
  const originalBytes = serializedLength(value);

  if (originalBytes <= maxBytes) {
    return { value, truncated: false, originalBytes };
  }

  const lengths: number[] = [];
  collectStringLengths(value, lengths);

  const stringBytes = lengths.reduce((sum, length) => sum + length, 0);
  const structuralBytes = originalBytes - stringBytes;
  const cap = findStringCap(lengths, Math.max(0, maxBytes - structuralBytes));

  // Structure alone blows the budget (pathological result shape): trimming
  // strings cannot save it, so keep them minimal and let it through rather
  // than mangling the payload.
  const effectiveCap = Number.isFinite(cap) ? Math.max(cap, MIN_SEGMENT_BYTES) : cap;

  const truncatedValue = mapStrings(value, (text) =>
    Number.isFinite(effectiveCap) ? truncateMiddle(text, effectiveCap) : text,
  );

  if (isPlainObject(truncatedValue)) {
    const note = options.fullOutputPath
      ? `This result exceeded the tool output budget and its long text fields were shortened. The complete output is saved at ${options.fullOutputPath} — open it with the read tool if you need the full content.`
      : "This result exceeded the tool output budget and its long text fields were shortened. Narrow the query or request fewer items if you need the full content.";

    return {
      value: {
        ...truncatedValue,
        outputTruncated: true,
        outputOriginalBytes: originalBytes,
        ...(options.fullOutputPath ? { fullOutputPath: options.fullOutputPath } : {}),
        outputTruncationNote: note,
      },
      truncated: true,
      originalBytes,
    };
  }

  return { value: truncatedValue, truncated: true, originalBytes };
}

type ExecutableTool = { execute?: (...args: unknown[]) => unknown };

/**
 * Apply the shared output budget to every executable tool in a set.
 *
 * Wrapping the assembled tool set — instead of each tool's own implementation —
 * is what makes the budget uniform across built-in and MCP tools alike. Mirrors
 * codex, which truncates at the single point where a result is recorded into
 * conversation history rather than inside each tool.
 */
export type ToolOutputTruncationInfo = {
  toolName: string;
  originalBytes: number;
  outputBytes: number;
  fullOutputPath: string | undefined;
};

export function withToolOutputLimit(
  tools: ToolSet,
  onTruncate?: (info: ToolOutputTruncationInfo) => void,
  maxBytes: number = TOOL_OUTPUT_MAX_BYTES,
): ToolSet {
  const limited: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    const execute = (tool as ExecutableTool).execute;

    // Client-side tools (AskUserQuestion) have no execute and never produce
    // server-side output to bound.
    if (typeof execute !== "function" || OUTPUT_LIMIT_EXEMPT_TOOLS.has(name)) {
      limited[name] = tool;
      continue;
    }

    const boundExecute = execute.bind(tool);
    limited[name] = {
      ...tool,
      execute: async (...callArgs: unknown[]) => {
        const output = await boundExecute(...callArgs);

        if (!exceedsToolOutputBudget(output, maxBytes)) {
          return output;
        }

        // Spill the full text first so the bounded result can point at it. A
        // failed spill yields undefined and simply omits the path — never turns
        // a successful tool call into a failure.
        const fullOutputPath = await persistToolOutput(name, serializeToolOutput(output));
        const result = truncateToolOutput(output, { maxBytes, fullOutputPath });

        onTruncate?.({
          toolName: name,
          originalBytes: result.originalBytes,
          outputBytes: serializedLength(result.value),
          fullOutputPath,
        });

        return result.value;
      },
    } as ToolSet[string];
  }

  return limited;
}
