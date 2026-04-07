import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai";
import { ToolCallCard } from "@/components/tool-call-card";

function roleLabel(role: UIMessage["role"]) {
  switch (role) {
    case "user":
      return "你";
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

  return (
    <article
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-role={message.role}
    >
      <div className="max-w-3xl space-y-2">
        <div
          className={`text-xs uppercase tracking-[0.22em] ${
            isUser ? "text-right text-slate-500" : "text-slate-500"
          }`}
        >
          {roleLabel(message.role)}
        </div>

        <div className="space-y-3">
          {message.parts.map((part, index) => {
            if (part.type === "text") {
              return (
                <div
                  key={`${message.id}-text-${index}`}
                  className={`rounded-[1.6rem] px-4 py-3 text-sm leading-7 shadow-sm ${
                    isUser
                      ? "bg-slate-950 text-white"
                      : "border border-black/10 bg-stone-50 text-slate-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{part.text}</p>
                </div>
              );
            }

            if (part.type === "reasoning") {
              return (
                <details
                  key={`${message.id}-reasoning-${index}`}
                  className="rounded-2xl border border-black/10 bg-amber-50/80 px-4 py-3 text-sm text-slate-700"
                >
                  <summary className="cursor-pointer font-medium text-amber-800">
                    模型推理片段
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-6 text-slate-700">
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
      </div>
    </article>
  );
}
