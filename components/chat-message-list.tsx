"use client";

import type { ChatStatus } from "ai";
import { ChatMessage } from "@/components/chat-message";
import type { AskUserQuestionOutput } from "@/lib/ai/ask-user-question";
import type { ChatUIMessage } from "@/lib/observability";

const starterPrompts = [
  "查看 Hacker News 当前最热门的 5 篇内容，分别总结主题、热度和网友讨论重点",
  "查一下当前国内外大模型 AI 公司有没有什么最新新闻，挑 3 条重要的总结",
  "帮我规划一个周末两天的杭州轻旅行行程，要求少走路、预算适中",
  "帮我创建 3 个待办：交水电费、预约体检、周五前整理报销材料",
];

/**
 * 滚动容器内的内容：空会话展示 Quick Starts，否则渲染消息列表。纯展示，所有状态与
 * 稳定回调（onRegenerate/onToolApprovalResponse/onQuestionAnswer 均为 ChatShell 的
 * useCallback）由父透传，禁止在此重包以保 ChatMessage 的 memo 不被击穿。带 ref 的滚动
 * 容器留在 ChatShell。
 */
export function ChatMessageList({
  messages,
  status,
  isBusy,
  onStarterPrompt,
  onRegenerate,
  onToolApprovalResponse,
  onQuestionAnswer,
}: {
  messages: ChatUIMessage[];
  status: ChatStatus;
  isBusy: boolean;
  onStarterPrompt: (prompt: string) => void | Promise<void>;
  onRegenerate: (messageId: string) => void;
  onToolApprovalResponse: (
    approvalId: string,
    approved: boolean,
  ) => Promise<void> | void;
  onQuestionAnswer: (
    toolCallId: string,
    output: AskUserQuestionOutput,
  ) => Promise<void> | void;
}) {
  if (messages.length === 0) {
    return (
      <div className="hidden min-h-[520px] items-center justify-center sm:flex">
        <section className="w-full max-w-3xl">
          <div className="mb-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
              Quick Starts
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {starterPrompts.map((prompt, index) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void onStarterPrompt(prompt)}
                disabled={isBusy}
                className="group flex items-start justify-between gap-4 rounded-lg border border-[rgba(23,23,23,0.12)] px-4 py-4 text-left transition hover:border-[rgba(201,106,43,0.45)] hover:bg-white/55 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div>
                  <p className="font-mono text-[11px] text-[#9e9285]">
                    0{index + 1}
                  </p>
                  <p className="mt-2 text-base leading-7 text-[#282019] transition group-hover:text-[#9c5626]">
                    {prompt}
                  </p>
                </div>
                <span className="mt-1 text-lg text-[#b7a99a] transition group-hover:translate-x-1 group-hover:text-[#9c5626]">
                  ↗
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {messages.map((message, index) => {
        const isLastMessage = index === messages.length - 1;
        const isStreamingMessage =
          isLastMessage
          && message.role === "assistant"
          && (status === "submitted" || status === "streaming");

        return (
          <div
            key={message.id}
            className="rise-in"
            style={{ animationDelay: `${Math.min(index * 40, 240)}ms` }}
          >
            <ChatMessage
              message={message}
              canRegenerate={message.role === "assistant"}
              isStreaming={isStreamingMessage}
              onRegenerate={onRegenerate}
              onToolApprovalResponse={onToolApprovalResponse}
              onQuestionAnswer={onQuestionAnswer}
              questionInteractionEnabled={isLastMessage && !isBusy}
            />
          </div>
        );
      })}
    </div>
  );
}
