import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentTimeline } from "@/components/agent-timeline";
import { ToolCallCard } from "@/components/tool-call-card";
import { parseAgentObservability } from "@/lib/observability";

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
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => (
                          <p className="whitespace-pre-wrap">{children}</p>
                        ),
                        pre: ({ children }) => (
                          <pre className="my-3 overflow-x-auto rounded-[14px] bg-[#171717] p-4 text-[#faf6f1]">
                            {children}
                          </pre>
                        ),
                        code: ({ children }) => (
                          <code
                            className={`rounded px-1.5 py-0.5 text-xs font-mono ${
                              isUser
                                ? "bg-white/10 text-[#fff8f2]"
                                : "bg-[#f1e7db] text-[#6b3718]"
                            }`}
                          >
                            {children}
                          </code>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc space-y-1 pl-5">{children}</ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal space-y-1 pl-5">{children}</ol>
                        ),
                      }}
                    >
                      {part.text}
                    </ReactMarkdown>
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
