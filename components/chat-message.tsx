"use client";

import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import Image from "next/image";
import { memo, useMemo, useState, type ReactNode } from "react";
import createDOMPurify from "dompurify";
import ReactMarkdown, { type Options as ReactMarkdownOptions } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import { SHIKI_THEME, useShikiHighlighter } from "@/lib/shiki";

type RehypePlugins = NonNullable<ReactMarkdownOptions["rehypePlugins"]>;

type HastTextLike = { type: "text"; value: string };
type HastElementLike = {
  type: "element";
  tagName: string;
  properties?: { className?: unknown };
  children: Array<HastNodeLike>;
};
type HastNodeLike = HastElementLike | HastTextLike | { type: string; value?: unknown; children?: unknown };
import { AgentTimeline } from "@/components/agent-timeline";
import { ToolCallCard } from "@/components/tool-call-card";
import type { AskUserQuestionOutput } from "@/lib/ai/ask-user-question";
import { formatMessageDateTime } from "@/lib/datetime";
import { getMessageTimestamp, parseAgentObservability } from "@/lib/observability";

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

function hastToText(node: HastNodeLike): string {
  if (node.type === "text" && typeof (node as HastTextLike).value === "string") {
    return (node as HastTextLike).value;
  }
  const children = (node as { children?: unknown }).children;
  if (Array.isArray(children)) {
    return children.map((child) => hastToText(child as HastNodeLike)).join("");
  }
  return "";
}

function extractLanguageFromHast(node: HastElementLike | undefined): string | null {
  if (!node || !Array.isArray(node.children)) {
    return null;
  }
  const codeNode = node.children.find(
    (child): child is HastElementLike =>
      (child as HastElementLike).type === "element"
      && (child as HastElementLike).tagName === "code",
  );
  const rawClass =
    (codeNode?.properties as { className?: unknown; class?: unknown } | undefined)?.className
    ?? (codeNode?.properties as { class?: unknown } | undefined)?.class;
  const classTokens: string[] = Array.isArray(rawClass)
    ? rawClass.filter((entry): entry is string => typeof entry === "string")
    : typeof rawClass === "string"
      ? rawClass.split(/\s+/)
      : [];
  for (const token of classTokens) {
    const match = token.match(/^language-([\w-]+)/);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function roleLabel(role: UIMessage["role"]) {
  switch (role) {
    case "user":
      return "操作员";
    case "assistant":
      return "Agent";
    case "system":
      return "System";
    default:
      return role;
  }
}

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

function formatTokenCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
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

function isSvgContent(language: string | null, code: string): boolean {
  return language === "svg" || (language === "xml" && code.trimStart().startsWith("<svg"));
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

function SvgPreview({
  code,
  styles,
}: {
  code: string;
  styles: (typeof markdownTextStyles)[keyof typeof markdownTextStyles];
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

function CodeBlock({
  code,
  language,
  children,
  styles,
}: {
  code: string;
  language: string | null;
  children: ReactNode;
  styles: (typeof markdownTextStyles)[keyof typeof markdownTextStyles];
}) {
  const [copied, setCopied] = useState(false);
  const [wrapped, setWrapped] = useState(false);

  if (isSvgContent(language, code)) {
    return <SvgPreview code={code} styles={styles} />;
  }

  async function handleCopyCode() {
    try {
      await copyText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error("Failed to copy code block:", error);
    }
  }

  return (
    <div className={styles.codeFrame}>
      <div className={styles.codeHeader}>
        <span className={styles.codeLabel}>
          {language ?? "code"}
        </span>
        <div className="flex items-center gap-2 text-[10px] text-[#8c7767]">
          <button
            type="button"
            onClick={() => setWrapped((value) => !value)}
            className={`inline-flex h-5 items-center rounded-full border px-2 transition ${
              wrapped
                ? "border-[rgba(156,86,38,0.28)] bg-[rgba(156,86,38,0.08)] text-[#9c5626]"
                : "border-[rgba(23,23,23,0.08)] text-[#8c7767] hover:text-[#9c5626]"
            }`}
            aria-label={wrapped ? "关闭代码换行" : "开启代码换行"}
            title={wrapped ? "关闭代码换行" : "开启代码换行"}
            aria-pressed={wrapped}
          >
            <span className="font-medium leading-none">
              {wrapped ? "换行开" : "换行关"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => void handleCopyCode()}
            className="inline-flex h-5 w-5 items-center justify-center transition hover:text-[#9c5626]"
            aria-label="复制代码块内容"
            title={copied ? "已复制" : "复制代码块内容"}
          >
            {copied ? (
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                className="h-3.5 w-3.5"
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
                className="h-3.5 w-3.5"
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
        </div>
      </div>
      <pre className={`${styles.pre} ${wrapped ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}>
        {children}
      </pre>
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
  onRegenerate?: () => void;
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
  const highlighter = useShikiHighlighter();
  const rehypePlugins = useMemo<RehypePlugins>(() => {
    const plugins: RehypePlugins = [rehypeKatex];
    if (highlighter && !isStreaming) {
      plugins.push([
        rehypeShikiFromHighlighter,
        highlighter,
        {
          theme: SHIKI_THEME,
          addLanguageClass: true,
        },
      ]);
    }
    return plugins;
  }, [highlighter, isStreaming]);
  const observability = !isUser ? parseAgentObservability(message.metadata) : null;
  const markdownStyles = isUser
    ? markdownTextStyles.user
    : markdownTextStyles.assistant;
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
            : "w-full max-w-3xl"
        }`}
      >
        <div
          className={`mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] ${
            isUser ? "justify-end text-[#9f9283]" : "text-[#8f8172]"
          }`}
        >
          {!isUser ? (
            <span className="h-2 w-2 rounded-full bg-[#c96a2b]" />
          ) : null}
          <span>{roleLabel(message.role)}</span>
          {isUser ? <span className="h-2 w-2 rounded-full bg-[#171717]" /> : null}
        </div>

        <div className="space-y-3">
          {message.parts
            .filter((part) => !(part.type === "text" && part.text.trim() === ""))
            .map((part, index) => {
              if (part.type === "text") {
                return (
                  <div
                    key={`${message.id}-text-${index}`}
                    className={`${
                      isUser ? "w-fit max-w-full" : ""
                    } rounded-[16px] px-4 py-3 text-[14px] leading-[1.625] sm:text-[15px] sm:leading-7 ${
                      isUser
                        ? "bg-[#4a3328] text-[#fff8f2] shadow-[0_16px_40px_rgba(74,51,40,0.14)]"
                        : "border border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.72)] text-[#2b231b]"
                    }`}
                  >
                    <div className={markdownStyles.prose}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={rehypePlugins}
                        components={{
                        h1: ({ children }) => (
                          <h1 className={`text-[28px] leading-[1.15] ${markdownStyles.heading}`}>
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className={`text-[22px] leading-[1.2] ${markdownStyles.heading}`}>
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className={`text-[18px] leading-[1.25] ${markdownStyles.heading}`}>
                            {children}
                          </h3>
                        ),
                        h4: ({ children }) => (
                          <h4 className={`text-[16px] leading-[1.3] ${markdownStyles.heading}`}>
                            {children}
                          </h4>
                        ),
                        p: ({ children }) => (
                          <p className={markdownStyles.paragraph}>{children}</p>
                        ),
                        pre: ({ children, node }) => {
                          const hastNode = node as HastElementLike | undefined;
                          const rawCode = hastNode ? hastToText(hastNode) : "";
                          const language = extractLanguageFromHast(hastNode);

                          return (
                            <CodeBlock
                              code={rawCode}
                              language={language}
                              styles={markdownStyles}
                            >
                              {children}
                            </CodeBlock>
                          );
                        },
                        code: ({ className, children }) => {
                          const isBlock = /language-[\w-]+/.test(className ?? "");
                          return (
                            <code
                              className={
                                isBlock
                                  ? `${className} ${markdownStyles.codeInPre}`
                                  : markdownStyles.inlineCode
                              }
                            >
                              {children}
                            </code>
                          );
                        },
                        strong: ({ children }) => (
                          <strong className={markdownStyles.strong}>{children}</strong>
                        ),
                        em: ({ children }) => (
                          <em className={markdownStyles.emphasis}>{children}</em>
                        ),
                        ul: ({ children }) => (
                          <ul className={`list-disc ${markdownStyles.list}`}>{children}</ul>
                        ),
                        ol: ({ children }) => (
                          <ol className={`list-decimal ${markdownStyles.list}`}>{children}</ol>
                        ),
                        li: ({ children }) => <li className="pl-1">{children}</li>,
                        blockquote: ({ children }) => (
                          <blockquote className={markdownStyles.blockquote}>
                            {children}
                          </blockquote>
                        ),
                        hr: () => <hr className={`my-5 border-t ${markdownStyles.rule}`} />,
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className={markdownStyles.link}
                          >
                            {children}
                          </a>
                        ),
                        table: ({ children }) => (
                          <div className={markdownStyles.tableWrap}>
                            <table className={markdownStyles.table}>{children}</table>
                          </div>
                        ),
                        thead: ({ children }) => <thead>{children}</thead>,
                        tbody: ({ children }) => <tbody>{children}</tbody>,
                        tr: ({ children }) => <tr className={markdownStyles.tableRow}>{children}</tr>,
                        th: ({ children }) => <th className={markdownStyles.th}>{children}</th>,
                        td: ({ children }) => <td className={markdownStyles.td}>{children}</td>,
                        }}
                      >
                        {part.text}
                      </ReactMarkdown>
                    </div>
                  </div>
                );
              }

              if (part.type === "source-url" || part.type === "source-document") {
                return null;
              }

              if (part.type === "reasoning") {
                return (
                  <details
                    key={`${message.id}-reasoning-${index}`}
                    className="rounded-[16px] border border-[rgba(201,106,43,0.18)] bg-[rgba(255,241,229,0.72)] px-4 py-3 text-sm text-[#4c3829]"
                  >
                    <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-[0.22em] text-[#a44d16]">
                      推理轨迹
                    </summary>
                    <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-6 text-[#6b5340]">
                      {"text" in part ? part.text : JSON.stringify(part, null, 2)}
                    </pre>
                  </details>
                );
              }

              if (isToolPart(part)) {
                return (
                  <ToolCallCard
                    key={`${message.id}-tool-${index}`}
                    invocation={part}
                    onApprovalResponse={onToolApprovalResponse}
                    onQuestionAnswer={onQuestionAnswer}
                    questionInteractionEnabled={questionInteractionEnabled}
                  />
                );
              }

              return null;
            })}
        </div>

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
                  onClick={onRegenerate}
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
          <div className="mt-3">
            <AgentTimeline observability={observability} />
          </div>
        ) : null}
      </div>
    </article>
  );
});
