import type { UIMessage } from "ai";

export type CitationSource = {
  /** Normalized URL, used both as map key and for href matching. */
  url: string;
  title: string | null;
  favicon: string | null;
  snippet: string | null;
};

export type CollectedSources = {
  sources: CitationSource[];
  byUrl: Map<string, CitationSource>;
};

type MessagePart = UIMessage["parts"][number];

// Tools whose `output.results[]` carry citable sources.
const SOURCE_TOOL_NAMES = new Set(["WebSearch", "WebFetch"]);
const SNIPPET_MAX_LENGTH = 220;

const EMPTY: CollectedSources = { sources: [], byUrl: new Map() };

/**
 * Normalize a URL for dedup and href matching: lowercase host, drop the
 * fragment and a single trailing slash. Falls back to a trimmed,
 * trailing-slash-stripped string when the input is not a valid URL.
 */
export function normalizeSourceUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    const normalized = url.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

// Mirror tool-call-card.tsx: strip the `tool-` prefix, or read `toolName` for
// dynamic tools.
function getToolName(part: MessagePart): string | null {
  if (part.type === "dynamic-tool") {
    return (part as { toolName?: string }).toolName ?? null;
  }
  return part.type.startsWith("tool-") ? part.type.replace(/^tool-/, "") : null;
}

function isResultOutput(
  output: unknown,
): output is { results: Array<Record<string, unknown>> } {
  if (!output || typeof output !== "object") return false;
  const record = output as Record<string, unknown>;
  return record.ok === true && Array.isArray(record.results);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function clampSnippet(value: string | null): string | null {
  if (!value) return null;
  return value.length <= SNIPPET_MAX_LENGTH
    ? value
    : `${value.slice(0, SNIPPET_MAX_LENGTH)}…`;
}

/**
 * Collect citable sources from a message's WebSearch / WebFetch tool results,
 * deduped by normalized URL in tool-return order. Shared by the source list and
 * the inline citation markers (which match a link's href back to a source).
 */
export function collectMessageSources(
  parts: MessagePart[] | undefined,
): CollectedSources {
  if (!parts || parts.length === 0) return EMPTY;

  const sources: CitationSource[] = [];
  const byUrl = new Map<string, CitationSource>();

  for (const part of parts) {
    const toolName = getToolName(part);
    if (!toolName || !SOURCE_TOOL_NAMES.has(toolName)) continue;
    if ((part as { state?: string }).state !== "output-available") continue;

    const output = (part as { output?: unknown }).output;
    if (!isResultOutput(output)) continue;

    for (const item of output.results) {
      const rawUrl = readString(item.url);
      if (!rawUrl) continue;
      const url = normalizeSourceUrl(rawUrl);
      if (!url || byUrl.has(url)) continue;

      const source: CitationSource = {
        url,
        title: readString(item.title),
        favicon: readString(item.favicon),
        snippet: clampSnippet(readString(item.contentPreview) ?? readString(item.content)),
      };
      sources.push(source);
      byUrl.set(url, source);
    }
  }

  return { sources, byUrl };
}
