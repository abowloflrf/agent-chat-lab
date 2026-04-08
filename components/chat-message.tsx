import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentTimeline } from "@/components/agent-timeline";
import { ToolCallCard } from "@/components/tool-call-card";
import { parseAgentObservability } from "@/lib/observability";

const markdownTextStyles = {
  user: {
    prose: "space-y-4 text-[15px] leading-7 text-[#fff8f2]",
    heading: "font-semibold tracking-[-0.02em] text-[#fffdf9]",
    paragraph: "whitespace-pre-wrap text-[15px] leading-7 text-[#fff8f2]",
    list: "space-y-2 pl-5 text-[15px] leading-7 marker:text-[#f1d2bb]",
    blockquote:
      "border-l-2 border-white/18 pl-4 italic text-[#f6ded0]",
    rule: "border-white/10",
    strong: "font-semibold text-[#fffdf9]",
    emphasis: "italic text-[#f6ded0]",
    inlineCode: "rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-[#fff8f2]",
    codeFrame: "my-4 overflow-hidden rounded-[14px] border border-white/8 bg-[#211712]",
    codeHeader:
      "flex items-center justify-between border-b border-white/8 bg-[rgba(255,255,255,0.04)] px-4 py-2",
    codeLabel: "font-mono text-[11px] uppercase tracking-[0.18em] text-[#d8c1b2]",
    pre: "overflow-x-auto px-4 py-4 text-[#faf6f1]",
    codeInPre: "bg-transparent px-0 py-0 text-[13px] leading-6 text-[#faf6f1]",
    link: "font-medium text-[#ffe0cc] underline decoration-white/30 underline-offset-4 transition hover:text-white",
    tableWrap:
      "my-4 overflow-x-auto rounded-[14px] border border-white/10 bg-[rgba(255,255,255,0.04)]",
    table: "min-w-full border-collapse text-left text-[13px] leading-6 text-[#fff4eb]",
    th: "border-b border-white/10 bg-[rgba(255,255,255,0.05)] px-4 py-2.5 font-medium tracking-[0.02em] text-[#fffdf9]",
    td: "border-t border-white/8 px-4 py-2.5 align-top text-[#f7e5d8]",
    tableRow: "odd:bg-[rgba(255,255,255,0.025)]",
  },
  assistant: {
    prose: "space-y-4 text-[15px] leading-7 text-[#2b231b]",
    heading: "font-semibold tracking-[-0.02em] text-[#1f1711]",
    paragraph: "whitespace-pre-wrap text-[15px] leading-7 text-[#2b231b]",
    list: "space-y-2 pl-5 text-[15px] leading-7 marker:text-[#b76837]",
    blockquote:
      "border-l-2 border-[rgba(201,106,43,0.28)] pl-4 italic text-[#6a5442]",
    rule: "border-[rgba(23,23,23,0.08)]",
    strong: "font-semibold text-[#1f1711]",
    emphasis: "italic text-[#725746]",
    inlineCode:
      "rounded bg-[#f1e7db] px-1.5 py-0.5 font-mono text-xs text-[#6b3718]",
    codeFrame:
      "my-4 overflow-hidden rounded-[14px] border border-[rgba(23,23,23,0.08)] bg-[#171717]",
    codeHeader:
      "flex items-center justify-between border-b border-white/8 bg-[rgba(255,255,255,0.04)] px-4 py-2",
    codeLabel: "font-mono text-[11px] uppercase tracking-[0.18em] text-[#d7c0b1]",
    pre: "overflow-x-auto px-4 py-4 text-[#faf6f1]",
    codeInPre: "bg-transparent px-0 py-0 text-[13px] leading-6 text-[#faf6f1]",
    link: "font-medium text-[#9c5626] underline decoration-[#d7b195] underline-offset-4 transition hover:text-[#7f4218]",
    tableWrap:
      "my-4 overflow-x-auto rounded-[14px] border border-[rgba(23,23,23,0.08)] bg-[rgba(250,246,240,0.88)]",
    table: "min-w-full border-collapse text-left text-[13px] leading-6 text-[#332922]",
    th: "border-b border-[rgba(23,23,23,0.08)] bg-[rgba(243,231,219,0.72)] px-4 py-2.5 font-medium tracking-[0.02em] text-[#3b2f25]",
    td: "border-t border-[rgba(23,23,23,0.06)] px-4 py-2.5 align-top text-[#55483d]",
    tableRow: "odd:bg-[rgba(255,255,255,0.35)]",
  },
} as const;

function getCodeLanguage(className?: string) {
  const match = className?.match(/language-([\w-]+)/);
  return match?.[1] ?? null;
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

type ToolLikePart = ToolUIPart | DynamicToolUIPart;

function isToolPart(part: UIMessage["parts"][number]): part is ToolLikePart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

export function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const observability = !isUser ? parseAgentObservability(message.metadata) : null;
  const markdownStyles = isUser
    ? markdownTextStyles.user
    : markdownTextStyles.assistant;

  return (
    <article
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
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
                    } rounded-[16px] px-4 py-3 text-[15px] leading-7 ${
                      isUser
                        ? "bg-[#4a3328] text-[#fff8f2] shadow-[0_16px_40px_rgba(74,51,40,0.14)]"
                        : "border border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.72)] text-[#2b231b]"
                    }`}
                  >
                    <div className={markdownStyles.prose}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
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
                        pre: ({ children }) => <>{children}</>,
                        code: ({ className, children }) => (
                          className ? (
                            <div className={markdownStyles.codeFrame}>
                              <div className={markdownStyles.codeHeader}>
                                <span className={markdownStyles.codeLabel}>
                                  {getCodeLanguage(className) ?? "code"}
                                </span>
                              </div>
                              <pre className={markdownStyles.pre}>
                                <code className={markdownStyles.codeInPre}>
                                  {children}
                                </code>
                              </pre>
                            </div>
                          ) : (
                            <code className={markdownStyles.inlineCode}>
                              {children}
                            </code>
                          )
                        ),
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
                  />
                );
              }

              return null;
            })}
        </div>

        {!isUser && observability ? (
          <div className="mt-3">
            <AgentTimeline observability={observability} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
