"use client";

import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import Image from "next/image";
import { memo, useMemo, useState } from "react";
import createDOMPurify from "dompurify";
import { Streamdown, type Components } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";
import { mermaid } from "@streamdown/mermaid";
import "streamdown/styles.css";
import { AgentTimeline } from "@/components/agent-timeline";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/source";
import { InlineCitationBadge } from "@/components/ai-elements/inline-citation";
import { ToolCallGroup } from "@/components/tool-call-card";
import type { AskUserQuestionOutput } from "@/lib/ai/ask-user-question";
import {
  collectMessageSources,
  normalizeSourceUrl,
} from "@/lib/ai/message-sources";
import { formatMessageDateTime } from "@/lib/datetime";
import { formatTokenCount } from "@/lib/format";
import { getMessageTimestamp, parseAgentObservability } from "@/lib/observability";

// Light-only app: force the same Shiki theme for both light/dark slots so code
// blocks match the previous github-light highlighting.
const codePlugin = createCodePlugin({ themes: ["github-light", "github-light"] });
// remark-math (previous renderer) parsed single-dollar inline math by default;
// keep that behaviour, since the Streamdown math plugin defaults it off.
const mathPlugin = createMathPlugin({ singleDollarTextMath: true });

const markdownTextStyles = {
  user: {
    prose: "space-y-4 text-[14px] leading-[1.625] sm:text-[15px] sm:leading-7 text-[#fff8f2]",
    heading: "font-semibold tracking-[-0.02em] text-[#fffdf9]",
    paragraph: "whitespace-pre-wrap text-[14px] leading-[1.625] sm:text-[15px] sm:leading-7 text-[#fff8f2]",
    list: "space-y-2 pl-5 text-[14px] leading-[1.625] sm:text-[15px] sm:leading-7 marker:text-[#f1d2bb]",
    blockquote:
      "border-l-2 border-white/18 pl-4 italic text-[#f6ded0]",
    rule: "border-white/10",
    strong: "font-semibold text-[#fffdf9]",
    emphasis: "italic text-[#f6ded0]",
    inlineCode: "rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-[#fff8f2]",
    codeFrame: "my-4 overflow-hidden rounded-[14px] border border-white/10 bg-[rgba(255,248,241,0.08)]",
    codeHeader:
      "flex items-center justify-between border-b border-white/10 bg-[rgba(255,255,255,0.04)] px-3 py-1.5",
    codeLabel: "font-mono text-[10px] uppercase tracking-[0.14em] text-[#d8c1b2]",
    pre: "overflow-x-auto px-3 py-2 text-[#fff6ef] leading-[1.4]",
    codeInPre: "bg-transparent px-0 py-0 font-mono text-[13px] leading-[1.4] text-[#fff6ef]",
    link: "font-medium text-[#ffe0cc] underline decoration-white/30 underline-offset-4 transition hover:text-white",
    tableWrap:
      "my-4 overflow-x-auto rounded-[14px] border border-white/10 bg-[rgba(255,255,255,0.04)]",
    table: "min-w-full border-collapse text-left text-[13px] leading-6 text-[#fff4eb]",
    th: "border-b border-white/10 bg-[rgba(255,255,255,0.05)] px-4 py-2.5 font-medium tracking-[0.02em] text-[#fffdf9]",
    td: "border-t border-white/8 px-4 py-2.5 align-top text-[#f7e5d8]",
    tableRow: "odd:bg-[rgba(255,255,255,0.025)]",
  },
  assistant: {
    prose: "space-y-4 text-[14px] leading-[1.625] sm:text-[15px] sm:leading-7 text-[#2b231b]",
    heading: "font-semibold tracking-[-0.02em] text-[#1f1711]",
    paragraph: "whitespace-pre-wrap text-[14px] leading-[1.625] sm:text-[15px] sm:leading-7 text-[#2b231b]",
    list: "space-y-2 pl-5 text-[14px] leading-[1.625] sm:text-[15px] sm:leading-7 marker:text-[#b76837]",
    blockquote:
      "border-l-2 border-[rgba(201,106,43,0.28)] pl-4 italic text-[#6a5442]",
    rule: "border-[rgba(23,23,23,0.08)]",
    strong: "font-semibold text-[#1f1711]",
    emphasis: "italic text-[#725746]",
    inlineCode:
      "rounded bg-[#f1e7db] px-1.5 py-0.5 font-mono text-xs text-[#6b3718]",
    codeFrame:
      "my-4 overflow-hidden rounded-[14px] border border-[rgba(23,23,23,0.08)] bg-[rgba(250,246,240,0.96)]",
    codeHeader:
      "flex items-center justify-between border-b border-[rgba(23,23,23,0.06)] bg-[rgba(255,255,255,0.65)] px-3 py-1.5",
    codeLabel: "font-mono text-[10px] uppercase tracking-[0.14em] text-[#8c7767]",
    pre: "overflow-x-auto px-3 py-2 text-[#332922] leading-[1.4]",
    codeInPre: "bg-transparent px-0 py-0 font-mono text-[13px] leading-[1.4] text-[#332922]",
    link: "font-medium text-[#9c5626] underline decoration-[#d7b195] underline-offset-4 transition hover:text-[#7f4218]",
    tableWrap:
      "my-4 overflow-x-auto rounded-[14px] border border-[rgba(23,23,23,0.08)] bg-[rgba(250,246,240,0.88)]",
    table: "min-w-full border-collapse text-left text-[13px] leading-6 text-[#332922]",
    th: "border-b border-[rgba(23,23,23,0.08)] bg-[rgba(243,231,219,0.72)] px-4 py-2.5 font-medium tracking-[0.02em] text-[#3b2f25]",
    td: "border-t border-[rgba(23,23,23,0.06)] px-4 py-2.5 align-top text-[#55483d]",
    tableRow: "odd:bg-[rgba(255,255,255,0.35)]",
  },
} as const;

type MarkdownStyles = (typeof markdownTextStyles)[keyof typeof markdownTextStyles];

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

function formatRate(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "--";
  }

  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function getAssistantStats(observability: ReturnType<typeof parseAgentObservability>) {
  if (!observability || observability.timeline.length === 0) {
    return null;
  }

  const totalOutputTokens = observability.timeline.reduce((sum, step) => {
    return sum + step.usage.outputTokens;
  }, 0);
  const totalDurationMs = observability.totalDurationMs
    ?? Math.max(0, (observability.finishedAt ?? observability.startedAt) - observability.startedAt);
  const firstStep = [...observability.timeline].sort((a, b) => a.stepNumber - b.stepNumber)[0];
  const ttftMs = firstStep
    ? Math.max(0, firstStep.finishedAt - observability.startedAt)
    : null;
  const tokensPerSecond = totalDurationMs > 0
    ? (totalOutputTokens * 1000) / totalDurationMs
    : 0;
  const modelId = firstStep?.modelId ?? null;

  return {
    totalOutputTokens,
    totalDurationMs,
    ttftMs,
    tokensPerSecond,
    modelId,
  };
}

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard API is unavailable.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand("copy");

    if (!copied) {
      throw new Error("execCommand copy failed.");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

type ToolLikePart = ToolUIPart | DynamicToolUIPart;

function isToolPart(part: UIMessage["parts"][number]): part is ToolLikePart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

type TextPart = Extract<UIMessage["parts"][number], { type: "text" }>;
type ReasoningPart = Extract<UIMessage["parts"][number], { type: "reasoning" }>;

type RenderBlock =
  | { kind: "text"; part: TextPart; index: number }
  | { kind: "reasoning"; part: ReasoningPart; index: number }
  | { kind: "tools"; parts: ToolLikePart[]; key: string };

function getReasoningText(part: ReasoningPart) {
  return typeof part.text === "string" ? part.text : "";
}

/**
 * 把 parts 折叠成渲染块：相邻的工具调用聚合成一个分组。
 * step-start / source-* 等不渲染的 part 视为透明，不打断工具分组，
 * 这样跨 step 的连续调用也能合并进同一个容器。
 */
function buildRenderBlocks(parts: UIMessage["parts"]): RenderBlock[] {
  const blocks: RenderBlock[] = [];

  parts.forEach((part, index) => {
    if (part.type === "text") {
      if (part.text.trim() !== "") {
        blocks.push({ kind: "text", part, index });
      }
      return;
    }

    if (part.type === "reasoning") {
      if (getReasoningText(part).trim() !== "") {
        blocks.push({ kind: "reasoning", part, index });
      }
      return;
    }

    if (isToolPart(part)) {
      const last = blocks[blocks.length - 1];

      if (last && last.kind === "tools") {
        last.parts.push(part);
      } else {
        blocks.push({ kind: "tools", parts: [part], key: part.toolCallId });
      }
    }
  });

  return blocks;
}

function sanitizeSvg(raw: string): string {
  if (typeof window === "undefined") return "";
  const purify = createDOMPurify(window);
  return purify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use"],
    ADD_ATTR: ["xmlns", "xmlns:xlink", "xlink:href", "viewBox"],
  });
}

function parseSvgDimensions(svg: string) {
  if (typeof window === "undefined") {
    return { width: 800, height: 600 };
  }

  const doc = new window.DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const widthAttr = root.getAttribute("width");
  const heightAttr = root.getAttribute("height");

  const width = widthAttr ? Number.parseFloat(widthAttr) : Number.NaN;
  const height = heightAttr ? Number.parseFloat(heightAttr) : Number.NaN;

  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height };
  }

  const viewBox = root.getAttribute("viewBox");
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part));

    if (parts.length === 4) {
      const [, , vbWidth, vbHeight] = parts;
      if (Number.isFinite(vbWidth) && vbWidth > 0 && Number.isFinite(vbHeight) && vbHeight > 0) {
        return { width: vbWidth, height: vbHeight };
      }
    }
  }

  return { width: 800, height: 600 };
}

/**
 * Visual preview for ```svg fences: renders the sanitized SVG as an image with a
 * source/preview toggle. Registered as a Streamdown custom renderer so it bypasses
 * the default code block for SVG content.
 */
function SvgPreview({
  code,
  styles,
}: {
  code: string;
  styles: MarkdownStyles;
}) {
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const preview = useMemo(() => {
    const sanitized = sanitizeSvg(code);
    if (!sanitized) {
      return null;
    }

    return {
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`,
      ...parseSvgDimensions(sanitized),
    };
  }, [code]);

  async function handleCopy() {
    try {
      await copyText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error("Failed to copy SVG:", error);
    }
  }

  return (
    <div className={styles.codeFrame}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLabel}>SVG</span>
        <div className="flex items-center gap-2 text-[10px] text-[#8c7767]">
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className={`inline-flex h-5 items-center rounded-full border px-2 transition ${
              showSource
                ? "border-[rgba(156,86,38,0.28)] bg-[rgba(156,86,38,0.08)] text-[#9c5626]"
                : "border-[rgba(23,23,23,0.08)] text-[#8c7767] hover:text-[#9c5626]"
            }`}
          >
            <span className="font-medium leading-none">
              {showSource ? "预览" : "源码"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex h-5 w-5 items-center justify-center transition hover:text-[#9c5626]"
            aria-label="复制 SVG"
            title={copied ? "已复制" : "复制 SVG"}
          >
            {copied ? (
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
                <path d="M4.5 10.5 8 14l7.5-8" className="stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
                <rect x="7" y="3" width="9" height="11" rx="2" className="stroke-current" strokeWidth="1.4" />
                <rect x="4" y="6" width="9" height="11" rx="2" className="stroke-current" strokeWidth="1.4" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {showSource ? (
        <pre className={`${styles.pre} whitespace-pre`}>
          <code className={styles.codeInPre}>{code}</code>
        </pre>
      ) : (
        <div
          suppressHydrationWarning
          className="flex items-center justify-center overflow-auto p-4"
        >
          {preview ? (
            <Image
              src={preview.src}
              alt="SVG preview"
              width={preview.width}
              height={preview.height}
              unoptimized
              className="h-auto max-w-full"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export const ChatMessage = memo(function ChatMessage({
  message,
  onRegenerate,
  canRegenerate = false,
  onToolApprovalResponse,
  onQuestionAnswer,
  questionInteractionEnabled = false,
  isStreaming = false,
}: {
  message: UIMessage;
  onRegenerate?: (messageId: string) => void;
  canRegenerate?: boolean;
  onToolApprovalResponse?: (approvalId: string, approved: boolean) => Promise<void> | void;
  onQuestionAnswer?: (
    toolCallId: string,
    output: AskUserQuestionOutput,
  ) => Promise<void> | void;
  questionInteractionEnabled?: boolean;
  isStreaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";
  const observability = !isUser ? parseAgentObservability(message.metadata) : null;
  const markdownStyles = isUser
    ? markdownTextStyles.user
    : markdownTextStyles.assistant;
  // Streamdown plugins: Shiki highlighting + KaTeX + CJK, plus a custom renderer
  // that previews ```svg fences. Memoized per theme (only two stable variants).
  const markdownPlugins = useMemo(
    () => ({
      code: codePlugin,
      math: mathPlugin,
      cjk,
      mermaid,
      renderers: [
        {
          language: ["svg"],
          component: ({ code }: { code: string }) => (
            <SvgPreview code={code} styles={markdownStyles} />
          ),
        },
      ],
    }),
    [markdownStyles],
  );
  // Sources collected from WebSearch/WebFetch results, shared by the source list
  // and the inline citation badges. Only assistant messages cite sources.
  const { sources, byUrl } = useMemo(
    () => (isUser ? { sources: [], byUrl: new Map() } : collectMessageSources(message.parts)),
    [isUser, message.parts],
  );
  // Override Streamdown's `a`: when the href matches a collected source, render
  // a citation badge; otherwise fall back to a themed link.
  const citationComponents = useMemo<Components>(
    () => ({
      a: ({ node, href, children, ...props }) => {
        // `node` is the parser's hast node; drop it so it isn't forwarded to the DOM.
        void node;
        const source = href ? byUrl.get(normalizeSourceUrl(href)) : undefined;
        if (source) {
          return <InlineCitationBadge source={source} />;
        }
        return (
          <a href={href} target="_blank" rel="noreferrer" className={markdownStyles.link} {...props}>
            {children}
          </a>
        );
      },
    }),
    [byUrl, markdownStyles.link],
  );
  const messageTimestamp = getMessageTimestamp(message.metadata);
  const assistantStats = !isUser ? getAssistantStats(observability) : null;
  const rawText = message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => {
      return part.type === "text" && part.text.trim() !== "";
    })
    .map((part) => part.text)
    .join("\n\n");

  async function handleCopy() {
    if (!rawText) {
      return;
    }

    try {
      await copyText(rawText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error("Failed to copy message text:", error);
    }
  }

  return (
    <article
      className={`group/message flex ${isUser ? "justify-end" : "justify-start"}`}
      data-role={message.role}
    >
      <div
        className={`${
          isUser
            ? "ml-auto flex w-full max-w-2xl flex-col items-end"
            : "w-full"
        }`}
      >
        <div className="space-y-3">
          {buildRenderBlocks(message.parts).map((block) => {
              if (block.kind === "text") {
                const part = block.part;
                return (
                  <div
                    key={`${message.id}-text-${block.index}`}
                    className={
                      isUser
                        ? "w-fit max-w-full rounded-[16px] bg-[#4a3328] px-4 py-3 text-[14px] leading-[1.625] text-[#fff8f2] shadow-[0_16px_40px_rgba(74,51,40,0.14)] sm:text-[15px] sm:leading-7"
                        : "text-[14px] leading-[1.625] text-[#2b231b] sm:text-[15px] sm:leading-7"
                    }
                  >
                    <Streamdown
                      plugins={markdownPlugins}
                      components={isUser ? undefined : citationComponents}
                    >
                      {part.text}
                    </Streamdown>
                  </div>
                );
              }

              if (block.kind === "reasoning") {
                const part = block.part;
                return (
                  <Reasoning
                    key={`${message.id}-reasoning-${block.index}`}
                    className="mb-5"
                    isStreaming={isStreaming && part.state === "streaming"}
                  >
                    <ReasoningTrigger />
                    <ReasoningContent>
                      {getReasoningText(part)}
                    </ReasoningContent>
                  </Reasoning>
                );
              }

              return (
                <ToolCallGroup
                  key={`${message.id}-tools-${block.key}`}
                  parts={block.parts}
                  onApprovalResponse={onToolApprovalResponse}
                  onQuestionAnswer={onQuestionAnswer}
                  interactionEnabled={questionInteractionEnabled}
                />
              );
            })}
        </div>

        {!isUser && sources.length > 0 ? (
          <Sources className="mt-3">
            <SourcesTrigger count={sources.length} />
            <SourcesContent>
              {sources.map((source) => (
                <Source
                  key={source.url}
                  href={source.url}
                  title={source.title ?? undefined}
                  favicon={source.favicon}
                />
              ))}
            </SourcesContent>
          </Sources>
        ) : null}

        {rawText ? (
          <div
            className={`mt-2 flex w-full items-center ${
              isUser ? "justify-end" : "justify-start"
            }`}
          >
            <div className={`flex items-center gap-1 ${isUser ? "" : "ml-auto"}`}>
              {!isUser && assistantStats ? (
                <div className="pointer-events-none mr-2 flex items-center gap-1.5 text-[11px] text-[#8f8172] opacity-0 transition-opacity duration-150 group-hover/message:opacity-100">
                  {assistantStats.modelId ? (
                    <span className="rounded border border-[rgba(201,106,43,0.2)] bg-[rgba(201,106,43,0.06)] px-1.5 py-0.5 font-mono text-[10px] text-[#9c5626]">
                      {assistantStats.modelId}
                    </span>
                  ) : null}
                  <span>
                    {formatTokenCount(assistantStats.totalOutputTokens)} tokens
                  </span>
                  <span>
                    TTFT {assistantStats.ttftMs === null ? "--" : formatDuration(assistantStats.ttftMs)}
                  </span>
                  <span>
                    {formatRate(assistantStats.tokensPerSecond)} tok/s
                  </span>
                  <span>
                    {formatDuration(assistantStats.totalDurationMs)}
                  </span>
                </div>
              ) : null}

              {messageTimestamp ? (
                <div
                  className={`pointer-events-none mr-1 text-[11px] transition-opacity duration-150 group-hover/message:opacity-100 ${
                    isUser ? "text-[#8c7d70] opacity-0" : "text-[#8f8172] opacity-0"
                  }`}
                >
                  {isUser ? "发送于" : "回复于"} {formatMessageDateTime(messageTimestamp)}
                </div>
              ) : null}

              <button
                type="button"
                onClick={handleCopy}
                aria-label="复制原始消息内容"
                title={copied ? "已复制" : "复制原始消息内容"}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                  isUser
                    ? "text-[#8c7d70] hover:text-[#4a3328]"
                    : "text-[#8f8172] hover:text-[#9c5626]"
                }`}
              >
                {copied ? (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                    className="h-4 w-4"
                  >
                    <path
                      d="M4.5 10.5 8 14l7.5-8"
                      className="stroke-current"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                    className="h-4 w-4"
                  >
                    <rect
                      x="7"
                      y="3"
                      width="9"
                      height="11"
                      rx="2"
                      className="stroke-current"
                      strokeWidth="1.4"
                    />
                    <rect
                      x="4"
                      y="6"
                      width="9"
                      height="11"
                      rx="2"
                      className="stroke-current"
                      strokeWidth="1.4"
                    />
                  </svg>
                )}
              </button>

              {!isUser && canRegenerate ? (
                <button
                  type="button"
                  onClick={() => onRegenerate?.(message.id)}
                  aria-label="从这条回复重新生成"
                  title="从这条回复重新生成"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#8f8172] transition hover:text-[#9c5626]"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                    className="h-4 w-4"
                  >
                    <path
                      d="M15.5 6.5V3.5m0 0h-3m3 0-3.1 3.1a5.5 5.5 0 1 0 1.15 5.9"
                      className="stroke-current"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!isUser && observability ? (
          <div className="mt-2">
            <AgentTimeline observability={observability} />
          </div>
        ) : null}
      </div>
    </article>
  );
});
