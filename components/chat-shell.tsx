"use client";

import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useChat } from "@ai-sdk/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChatMessage } from "@/components/chat-message";
import { ConversationList } from "@/components/conversation-list";
import {
  ModelSelector,
  type ModelSelection,
} from "@/components/model-selector";
import {
  agentObservabilitySchema,
  finalizeInterruptedMessage,
  getMessageTimestamp,
  isInterruptedMessage,
  parseAgentObservability,
  type ChatUIMessage,
} from "@/lib/observability";
import type { ProviderSettings } from "@/lib/provider-config";

const starterPrompts = [
  "现在几点了？",
  "帮我计算 (18.5 + 7.2) * 3",
  "记住一条笔记：标题是 Agent 学习目标，内容是先学会工具调用和状态管理",
  "帮我回忆一下和 Agent 学习有关的笔记",
];

const MIN_TEXTAREA_ROWS = 1;
const MAX_TEXTAREA_ROWS = 6;
const STREAM_RECOVERY_IDLE_MS = 20000;

type ChatShellProps = {
  initialConversationId: string;
  initialConversationTitle: string | null;
  initialMessages: ChatUIMessage[];
};

class ModelOverrideStore {
  #value: ModelSelection | null = null;

  get() {
    return this.#value;
  }

  set(value: ModelSelection | null) {
    this.#value = value;
  }
}

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatContextLength(tokenCount: number | null) {
  if (tokenCount === null) {
    return "--";
  }

  return new Intl.NumberFormat("zh-CN").format(tokenCount);
}

function formatShortConversationId(conversationId: string) {
  return conversationId.slice(0, 8);
}

function extractMessageText(message: ChatUIMessage) {
  return message.parts
    .filter((part): part is Extract<ChatUIMessage["parts"][number], { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function normalizeRecoveredMessages(chatMessages: ChatUIMessage[]) {
  return chatMessages.map((message) => finalizeInterruptedMessage(message));
}

function findLastUserMessageText(chatMessages: ChatUIMessage[]) {
  const latestUserMessage = [...chatMessages]
    .reverse()
    .find((message) => message.role === "user");

  return latestUserMessage ? extractMessageText(latestUserMessage) : "";
}

export function ChatShell({
  initialConversationId,
  initialConversationTitle,
  initialMessages,
}: ChatShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeConversationId = searchParams.get("conversationId");
  const [draft, setDraft] = useState("");
  const [localConversationId, setLocalConversationId] =
    useState(initialConversationId);
  const [conversationTitle, setConversationTitle] =
    useState(initialConversationTitle);
  const [currentMessages, setCurrentMessages] =
    useState<ChatUIMessage[]>(() => normalizeRecoveredMessages(initialMessages));
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [interruptedRunDetected, setInterruptedRunDetected] = useState(() => {
    return normalizeRecoveredMessages(initialMessages).some((message) =>
      isInterruptedMessage(message.metadata),
    );
  });
  const [providers, setProviders] = useState<ProviderSettings[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(null);
  const [modelOverrideStore] = useState(() => new ModelOverrideStore());
  const [transport] = useState(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ body, id, messages }) => {
          const override = modelOverrideStore.get();
          return {
            body: {
              ...body,
              conversationId: id,
              messages,
              ...(override
                ? {
                    modelOverride: {
                      providerId: override.providerId,
                      modelId: override.modelId,
                    },
                  }
                : {}),
            },
          };
        },
      }),
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const streamActivityAtRef = useRef(0);
  const conversationId = routeConversationId ?? localConversationId;

  useEffect(() => {
    modelOverrideStore.set(selectedModel);
  }, [modelOverrideStore, selectedModel]);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        const settingsProviders: ProviderSettings[] =
          data.settings?.providers ?? [];
        setProviders(settingsProviders);

        const defaultProvider =
          settingsProviders.find((p) => p.isEnabled && p.isDefault) ??
          settingsProviders.find((p) => p.isEnabled);

        if (!defaultProvider) return;

        const defaultModel =
          defaultProvider.models.find((m) => m.isEnabled && m.isDefault) ??
          defaultProvider.models.find((m) => m.isEnabled);

        if (!defaultModel) return;

        setSelectedModel({
          providerId: defaultProvider.id,
          providerName: defaultProvider.name,
          modelId: defaultModel.modelId,
        });
      })
      .catch((err) => console.error("Failed to load model settings:", err));
  }, []);

  const {
    messages,
    sendMessage,
    status,
    error,
    stop,
    setMessages,
    clearError,
    addToolApprovalResponse,
  } =
    useChat<ChatUIMessage>({
      id: conversationId,
      messages: currentMessages,
      messageMetadataSchema: agentObservabilitySchema,
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    });

  useEffect(() => {
    if (routeConversationId && routeConversationId !== localConversationId) {
      fetch(`/api/conversations/${routeConversationId}`)
        .then((res) => res.json())
        .then((data) => {
          setLocalConversationId(routeConversationId);
          if (data.conversation) {
            const recoveredMessages = normalizeRecoveredMessages(data.conversation.messages);
            setConversationTitle(data.conversation.title ?? null);
            setCurrentMessages(recoveredMessages);
            setMessages(recoveredMessages);
            setInterruptedRunDetected(
              recoveredMessages.some((message) => isInterruptedMessage(message.metadata)),
            );
          } else {
            setConversationTitle(null);
            setCurrentMessages([]);
            setMessages([]);
            setInterruptedRunDetected(false);
          }
        })
        .catch((fetchError) => {
          console.error("Failed to load conversation:", fetchError);
          setLocalConversationId(routeConversationId);
          setConversationTitle(null);
          setCurrentMessages([]);
          setMessages([]);
          setInterruptedRunDetected(false);
        });
    }
  }, [localConversationId, routeConversationId, setMessages]);

  useEffect(() => {
    streamActivityAtRef.current = Date.now();
  }, [messages, status]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 28;
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    const verticalPadding = paddingTop + paddingBottom;
    const minHeight = lineHeight * MIN_TEXTAREA_ROWS + verticalPadding;
    const maxHeight = lineHeight * MAX_TEXTAREA_ROWS + verticalPadding;

    textarea.style.height = "0px";
    const nextHeight = Math.min(
      Math.max(textarea.scrollHeight, minHeight),
      maxHeight,
    );
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  useEffect(() => {
    const hasMissingTimestamp = messages.some((message) => {
      return message.role === "user" && getMessageTimestamp(message.metadata) === null;
    });

    if (!hasMissingTimestamp) {
      return;
    }

    setMessages((currentMessages) =>
      currentMessages.map((message) => {
        if (message.role !== "user" || getMessageTimestamp(message.metadata) !== null) {
          return message;
        }

        return {
          ...message,
          metadata: {
            ...(message.metadata ?? {}),
            createdAt: Date.now(),
          },
        };
      }),
    );
  }, [messages, setMessages]);

  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const hasStreamingAssistant = messages.some((message) => {
      const observability = parseAgentObservability(message.metadata);
      return message.role === "assistant" && observability?.status === "streaming";
    });
    const latestUserIndex = [...messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.role === "user")?.index;
    const hasPendingUserTurn =
      latestUserIndex !== undefined &&
      messages[latestUserIndex]?.role === "user" &&
      !messages.slice(latestUserIndex + 1).some((message) => message.role === "assistant");

    if (!isBusy || (!hasStreamingAssistant && !hasPendingUserTurn)) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (Date.now() - streamActivityAtRef.current < STREAM_RECOVERY_IDLE_MS) {
        return;
      }

      stop();
      clearError();
      const recoveredMessages = normalizeRecoveredMessages(messages);
      setCurrentMessages(recoveredMessages);
      setMessages(recoveredMessages);
      setInterruptedRunDetected(true);
    }, STREAM_RECOVERY_IDLE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [clearError, isBusy, messages, setMessages, status, stop]);
  const latestUserMessageText = findLastUserMessageText(messages);
  const canReplayLatestTurn = !isBusy && latestUserMessageText.length > 0;
  const userMessageCount = messages.filter(
    (message) => message.role === "user",
  ).length;
  const toolStepCount = messages.reduce((count, message) => {
    return (
      count +
      message.parts.filter(
        (part) => part.type === "dynamic-tool" || part.type.startsWith("tool-"),
      ).length
    );
  }, 0);
  const currentContextLength = messages.reduce<number | null>((maxTokens, message) => {
    const observability = parseAgentObservability(message.metadata);
    const messageMaxInputTokens = observability?.timeline.reduce((messageMax, step) => {
      return Math.max(messageMax, step.usage.inputTokens);
    }, 0);

    if (messageMaxInputTokens === undefined) {
      return maxTokens;
    }

    return maxTokens === null
      ? messageMaxInputTokens
      : Math.max(maxTokens, messageMaxInputTokens);
  }, null);
  const sessionStats = [
    {
      label: "总上下文",
      value: formatContextLength(currentContextLength),
      unit: "tokens",
    },
    {
      label: "消息",
      value: String(messages.length),
      unit: "条",
    },
    {
      label: "工具步",
      value: String(toolStepCount),
      unit: "次",
    },
    {
      label: "输入轮次",
      value: String(userMessageCount),
      unit: "轮",
    },
  ];
  const displayConversationTitle = conversationTitle || "未命名会话";

  function scrollToBottom() {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }

  async function submitMessage() {
    const text = draft.trim();

    if (!text || isBusy) {
      return;
    }

    setDraft("");
    clearError();
    setInterruptedRunDetected(false);
    scrollToBottom();
    await sendMessage({ text });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitMessage();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submitMessage();
    }
  }

  async function handleStarterPrompt(prompt: string) {
    if (isBusy) {
      return;
    }

    clearError();
    setInterruptedRunDetected(false);
    await sendMessage({ text: prompt });
  }

  async function handleRegenerateFromMessage(messageId: string) {
    if (isBusy) {
      return;
    }

    const assistantIndex = messages.findIndex((message) => message.id === messageId);

    if (assistantIndex <= 0) {
      return;
    }

    const userIndex = [...messages]
      .slice(0, assistantIndex)
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.role === "user")?.index;

    if (userIndex === undefined) {
      return;
    }

    const userText = extractMessageText(messages[userIndex]);

    if (!userText) {
      return;
    }

    const nextMessages = messages.slice(0, userIndex);
    flushSync(() => {
      setCurrentMessages(nextMessages);
      setMessages(nextMessages);
    });
    clearError();
    setInterruptedRunDetected(false);
    await sendMessage({ text: userText });
  }

  async function handleReplayLatestTurn() {
    if (!latestUserMessageText || isBusy) {
      return;
    }

    const latestUserIndex = [...messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.role === "user")?.index;

    if (latestUserIndex === undefined) {
      return;
    }

    const nextMessages = messages.slice(0, latestUserIndex);
    flushSync(() => {
      setCurrentMessages(nextMessages);
      setMessages(nextMessages);
    });
    clearError();
    setInterruptedRunDetected(false);
    await sendMessage({ text: latestUserMessageText });
  }

  async function handleToolApprovalResponse(approvalId: string, approved: boolean) {
    if (isBusy) {
      return;
    }

    clearError();
    await addToolApprovalResponse({
      id: approvalId,
      approved,
      reason: approved ? "用户已允许执行此命令。" : "用户拒绝执行此命令。",
    });
  }

  function handleNewConversation() {
    if (isCreatingConversation) {
      return;
    }

    if (messages.length === 0) {
      return;
    }

    setIsCreatingConversation(true);
    const newId = crypto.randomUUID ? crypto.randomUUID() : generateUUID();
    router.push(`/?conversationId=${newId}`, {
      scroll: false,
    });
    
    setTimeout(() => {
      setIsCreatingConversation(false);
    }, 100);
  }

  return (
    <main className="app-shell h-screen overflow-hidden text-[#171717]">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="dark-panel rise-in relative h-full overflow-hidden border-r border-white/10 p-4 lg:p-4">
          <div className="relative flex h-full flex-col">
            <div className="border-b border-white/8 pb-4">
              <div>
                <p className="text-[28px] font-semibold leading-[0.95] text-[#fff7ef]">
                  Agent Chat Lab
                </p>
                <Link
                  href="/settings"
                  className="mt-3 inline-flex rounded-md border border-white/12 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-[#f3dfcf] transition hover:border-[#d98a52] hover:bg-white/6"
                >
                  系统设置
                </Link>
              </div>
            </div>

            <section className="min-h-0 flex-1 pt-4">
              <ConversationList
                currentConversationId={conversationId}
                onNewConversation={handleNewConversation}
                onConversationTitleChange={setConversationTitle}
                refreshTrigger={isBusy ? 1 : 0}
                isCreatingConversation={isCreatingConversation}
              />
            </section>
          </div>
        </aside>

        <section className="glass-panel rise-in relative flex h-full min-h-0 flex-col overflow-hidden">
          <header className="relative border-b border-[rgba(23,23,23,0.08)] px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <p className="truncate text-lg font-semibold tracking-[-0.02em] text-[#241c15]">
                    {displayConversationTitle}
                  </p>
                  <span className="inline-flex items-center rounded-full border border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.52)] px-2.5 py-1 font-mono text-[11px] text-[#6c6156]">
                    {formatShortConversationId(conversationId)}
                  </span>
                </div>
              </div>

              <div className="grid w-full gap-x-5 gap-y-3 border-t border-[rgba(23,23,23,0.08)] pt-3 text-sm text-[#5c544a] sm:grid-cols-2 lg:w-auto lg:grid-cols-4 lg:border-t-0 lg:pt-0">
                {sessionStats.map((stat) => (
                  <div
                    key={stat.label}
                    className="min-w-[108px] border-l border-[rgba(23,23,23,0.08)] pl-3 first:border-l-0 first:pl-0"
                  >
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[#978b7e]">
                      {stat.label}
                    </p>
                    <div className="mt-1 flex items-end gap-1.5 text-[#352d25]">
                      <span className="font-mono text-lg leading-none">
                        {stat.value}
                      </span>
                      <span className="pb-0.5 text-[11px] uppercase tracking-[0.16em] text-[#8f8377]">
                        {stat.unit}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </header>

          <div ref={scrollContainerRef} className="relative flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex min-h-[520px] items-center justify-center">
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
                        onClick={() => void handleStarterPrompt(prompt)}
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
            ) : (
              <div className="mx-auto max-w-4xl space-y-6">
                {messages.map((message, index) => (
                  <div
                    key={message.id}
                    className="rise-in"
                    style={{ animationDelay: `${Math.min(index * 40, 240)}ms` }}
                  >
                    <ChatMessage
                      message={message}
                      canRegenerate={message.role === "assistant"}
                      onRegenerate={() => void handleRegenerateFromMessage(message.id)}
                      onToolApprovalResponse={(approvalId, approved) =>
                        handleToolApprovalResponse(approvalId, approved)
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="relative border-t border-[rgba(23,23,23,0.08)] bg-[rgba(255,250,244,0.92)] px-4 py-4">
            {interruptedRunDetected && !isBusy ? (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-[18px] border border-[#ead4ba] bg-[#fff6ea] px-4 py-3 text-sm text-[#805126]">
                <span>检测到上一次 Agent 执行被中断，当前已恢复为可继续操作状态。</span>
                <button
                  type="button"
                  onClick={() => void handleReplayLatestTurn()}
                  disabled={!canReplayLatestTurn}
                  className="shrink-0 rounded-full border border-[#d7b38e] px-3 py-1.5 text-xs font-medium text-[#7f4218] transition hover:border-[#b86b36] hover:text-[#9c5626] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  重新生成上一条回复
                </button>
              </div>
            ) : null}

            {error ? (
              <div className="mb-3 rounded-[18px] border border-[#e8b5a7] bg-[#fff1ec] px-4 py-3 text-sm text-[#9a3818]">
                {error.message}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="sr-only">输入消息</span>
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入消息，例如：帮我记住今天要继续完善 Agent 的工具调用演示。"
                  rows={MIN_TEXTAREA_ROWS}
                  className="w-full resize-none rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-4 py-2.5 text-[15px] leading-7 text-[#171717] outline-none transition placeholder:text-[#9f968b] focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                  style={{
                    minHeight: `calc(${MIN_TEXTAREA_ROWS}lh + 1.25rem)`,
                    maxHeight: `calc(${MAX_TEXTAREA_ROWS}lh + 1.25rem)`,
                  }}
                />
              </label>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <ModelSelector
                    providers={providers}
                    selected={selectedModel}
                    onSelect={setSelectedModel}
                    disabled={isBusy}
                  />
                  <span className="hidden text-[11px] text-[#9f968b] sm:inline">
                    Enter 发送 · Shift+Enter 换行
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isBusy ? (
                    <button
                      type="button"
                      onClick={() => void stop()}
                      className="rounded-full border border-[rgba(23,23,23,0.14)] px-3.5 py-1.5 text-xs font-medium text-[#4a4138] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626]"
                    >
                      停止
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={isBusy || draft.trim().length === 0}
                    className="rounded-lg bg-[#171717] px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-white transition hover:bg-[#2b241d] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy ? "生成中..." : "发送"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
