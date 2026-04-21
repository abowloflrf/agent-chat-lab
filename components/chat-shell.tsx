"use client";

import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useChat } from "@ai-sdk/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ChatMessage } from "@/components/chat-message";
import { ConversationList } from "@/components/conversation-list";
import { ModuleSwitcher } from "@/components/module-switcher";
import { DEFAULT_CONVERSATION_TITLE } from "@/lib/constants";
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
const CHAT_INSTANCE_ID = "chat-shell";

type ChatShellProps = {
  initialConversationId: string | null;
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
  const initialRecoveredMessages = normalizeRecoveredMessages(initialMessages);
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeConversationId = searchParams.get("conversationId");
  const [draft, setDraft] = useState("");
  const [localConversationId, setLocalConversationId] =
    useState(initialConversationId);
  const [conversationTitle, setConversationTitle] =
    useState(initialConversationTitle);
  const [currentMessages, setCurrentMessages] =
    useState<ChatUIMessage[]>(() => initialRecoveredMessages);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarRefreshCounter, setSidebarRefreshCounter] = useState(0);
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  const [conversationCreationError, setConversationCreationError] =
    useState<string | null>(null);
  const [interruptedRunDetected, setInterruptedRunDetected] = useState(() => {
    return initialRecoveredMessages.some((message) =>
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
          const requestConversationId = conversationIdRef.current ?? id;
          return {
            body: {
              ...body,
              conversationId: requestConversationId,
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
  const [headerHidden, setHeaderHidden] = useState(false);
  const lastScrollTopRef = useRef(0);
  const scrollDeltaAccRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const streamActivityAtRef = useRef(0);
  const conversationIdRef = useRef<string | null>(initialConversationId);
  const previousRouteConversationIdRef = useRef<string | null>(routeConversationId);
  const isResettingToNewConversationRef = useRef(false);
  const conversationId = routeConversationId ?? localConversationId;

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    modelOverrideStore.set(selectedModel);
  }, [modelOverrideStore, selectedModel]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (window.innerWidth >= 1024) {
      setHeaderHidden(false);
      return;
    }
    const scrollTop = container.scrollTop;
    const delta = scrollTop - lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;
    if (Math.abs(delta) < 2) return;
    // Accumulate scroll distance in the same direction; reset on direction change
    if ((delta > 0 && scrollDeltaAccRef.current < 0) || (delta < 0 && scrollDeltaAccRef.current > 0)) {
      scrollDeltaAccRef.current = 0;
    }
    scrollDeltaAccRef.current += delta;
    // Require 30px accumulated scroll before toggling
    if (scrollDeltaAccRef.current > 30 && scrollTop > 50) {
      setHeaderHidden(true);
    } else if (scrollDeltaAccRef.current < -30) {
      setHeaderHidden(false);
    }
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const header = headerRef.current;
    const container = scrollContainerRef.current;
    if (!header || !container) return;

    const update = () => {
      container.style.setProperty("--header-h", `${header.offsetHeight}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

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
      id: CHAT_INSTANCE_ID,
      messages: currentMessages,
      messageMetadataSchema: agentObservabilitySchema,
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    });

  // Close sidebar on conversation change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [routeConversationId]);

  useEffect(() => {
    const previousRouteConversationId = previousRouteConversationIdRef.current;
    previousRouteConversationIdRef.current = routeConversationId;

    if (routeConversationId === null) {
      if (
        previousRouteConversationId !== null ||
        isResettingToNewConversationRef.current
      ) {
        isResettingToNewConversationRef.current = false;
        conversationIdRef.current = null;
        setLocalConversationId(null);
        setConversationTitle(null);
        setCurrentMessages([]);
        setMessages([]);
        setInterruptedRunDetected(false);
      }
      return;
    }

    if (isResettingToNewConversationRef.current) {
      return;
    }

    if (routeConversationId && routeConversationId !== localConversationId) {
      let cancelled = false;

      fetch(`/api/conversations/${routeConversationId}`)
        .then((res) => res.json())
        .then((data) => {
          if (cancelled || isResettingToNewConversationRef.current) {
            return;
          }

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
          if (cancelled || isResettingToNewConversationRef.current) {
            return;
          }

          console.error("Failed to load conversation:", fetchError);
          setLocalConversationId(routeConversationId);
          setConversationTitle(null);
          setCurrentMessages([]);
          setMessages([]);
          setInterruptedRunDetected(false);
        });

      return () => {
        cancelled = true;
      };
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
  const prevIsBusyRef = useRef(isBusy);

  useEffect(() => {
    const wasBusy = prevIsBusyRef.current;
    prevIsBusyRef.current = isBusy;

    // Refresh sidebar on any isBusy transition (start or end of chat)
    if (wasBusy !== isBusy) {
      setSidebarRefreshCounter((c) => c + 1);
    }

    // Only proceed when chat just finished (busy → idle)
    if (!wasBusy || isBusy) return;

    // If this isn't the first exchange, no need to poll for title
    const cid = conversationIdRef.current;
    const userCount = messages.filter((m) => m.role === "user").length;
    const assistantCount = messages.filter((m) => m.role === "assistant").length;
    if (!cid || userCount !== 1 || assistantCount !== 1) return;

    // Poll until the DB title changes (temp title from first message → LLM title).
    // Fetch immediately to capture baseline before LLM finishes, then poll every 2s.
    const POLL_INTERVAL = 2000;
    const MAX_ATTEMPTS = 15;
    let attempt = 0;
    let baselineTitle: string | null = null;
    let done = false;

    async function check() {
      try {
        const res = await fetch(`/api/conversations/${cid}`);
        if (res.ok && !done) {
          const { conversation } = await res.json();
          const title: string | null = conversation?.title || null;

          if (baselineTitle === null) {
            baselineTitle = title;
          } else if (title && title !== baselineTitle) {
            setPendingTitle(title);
            done = true;
            window.clearInterval(timer);
          }
        }
      } catch {
        // ignore
      }
    }

    void check(); // immediate baseline capture

    const timer = window.setInterval(() => {
      attempt++;
      if (attempt >= MAX_ATTEMPTS) {
        window.clearInterval(timer);
        return;
      }
      void check();
    }, POLL_INTERVAL);

    return () => {
      window.clearInterval(timer);
    };
  }, [isBusy, messages]);

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
  const displayConversationTitle = conversationTitle || DEFAULT_CONVERSATION_TITLE;

  function scrollToBottom() {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }

  async function ensureConversationId() {
    if (conversationIdRef.current) {
      return conversationIdRef.current;
    }

    setIsCreatingConversation(true);
    setConversationCreationError(null);

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const data = await res.json();
      const nextConversationId = data.conversation?.id;

      if (typeof nextConversationId !== "string" || nextConversationId.length === 0) {
        throw new Error("Missing conversation id.");
      }

      conversationIdRef.current = nextConversationId;
      setLocalConversationId(nextConversationId);
      router.replace(`/?conversationId=${nextConversationId}`, {
        scroll: false,
      });
      return nextConversationId;
    } catch (creationError) {
      console.error("Failed to create conversation:", creationError);
      setConversationCreationError("创建新会话失败，请重试。");
      throw creationError;
    } finally {
      setIsCreatingConversation(false);
    }
  }

  async function submitMessage() {
    const text = draft.trim();

    if (!text || isBusy) {
      return;
    }

    clearError();
    setConversationCreationError(null);
    setInterruptedRunDetected(false);
    scrollToBottom();
    await ensureConversationId();
    setDraft("");
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
    setConversationCreationError(null);
    setInterruptedRunDetected(false);
    scrollToBottom();
    await ensureConversationId();
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
    setConversationCreationError(null);
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
    setConversationCreationError(null);
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

    if (!conversationId && messages.length === 0) {
      return;
    }

    isResettingToNewConversationRef.current = true;
    conversationIdRef.current = null;
    setConversationCreationError(null);
    setConversationTitle(null);
    setPendingTitle(null);
    setCurrentMessages([]);
    setMessages([]);
    setInterruptedRunDetected(false);
    clearError();
    setDraft("");
    setLocalConversationId(null);
    router.push("/", {
      scroll: false,
    });
  }

  return (
    <main className="app-shell h-full overflow-hidden text-[#171717]">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className="grid h-full grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside
          className={`dark-panel rise-in fixed inset-y-0 left-0 z-50 w-[280px] overflow-hidden border-r border-white/10 p-4 pt-[max(1rem,env(safe-area-inset-top))] transition-transform duration-200 lg:relative lg:z-auto lg:w-auto lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="relative flex h-full flex-col">
            <div className="border-b border-white/8 pb-4">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <ModuleSwitcher />
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[#cabfb2] transition hover:bg-white/10 hover:text-white lg:hidden"
                >
                  ✕
                </button>
              </div>
            </div>

            <section className="min-h-0 flex-1 pt-4">
              <ConversationList
                currentConversationId={conversationId}
                onNewConversation={() => {
                  handleNewConversation();
                  setSidebarOpen(false);
                }}
                onConversationTitleChange={setConversationTitle}
                refreshTrigger={sidebarRefreshCounter}
                isCreatingConversation={isCreatingConversation}
                pendingTitle={pendingTitle}
              />
            </section>
          </div>
        </aside>

        <section className="glass-panel rise-in relative flex h-full min-h-0 flex-col overflow-hidden">
          <header
            ref={headerRef}
            className={`absolute inset-x-0 top-0 z-20 border-b border-[rgba(23,23,23,0.08)] bg-[rgba(255,252,247,0.95)] transition-transform duration-200 ease-out will-change-transform lg:static lg:z-auto lg:translate-y-0 lg:bg-transparent ${
              headerHidden ? "-translate-y-full lg:translate-y-0" : "translate-y-0"
            }`}
          >
            <div className="px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(true)}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(23,23,23,0.1)] text-[#5c544a] transition hover:bg-[rgba(23,23,23,0.04)] lg:hidden"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <line x1="3" y1="12" x2="21" y2="12" />
                      <line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                  </button>
                  <p className="truncate text-lg font-semibold tracking-[-0.02em] text-[#241c15]">
                    {displayConversationTitle}
                  </p>
                  {conversationId ? (
                    <span className="hidden items-center rounded-full border border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.52)] px-2.5 py-1 font-mono text-[11px] text-[#6c6156] sm:inline-flex">
                      {formatShortConversationId(conversationId)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="hidden gap-x-5 gap-y-3 border-t border-[rgba(23,23,23,0.08)] pt-3 text-sm text-[#5c544a] sm:grid sm:grid-cols-2 lg:w-auto lg:grid-cols-4 lg:border-t-0 lg:pt-0">
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
            </div>
          </header>

          <div
            ref={scrollContainerRef}
            className="relative flex-1 overflow-y-auto px-4 pb-4 pt-[calc(var(--header-h,3.5rem)+1rem)] lg:pt-4"
          >
            {messages.length === 0 ? (
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

          <div className="relative border-t border-[rgba(23,23,23,0.08)] bg-[rgba(255,250,244,0.92)] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:px-4 lg:py-4 lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
            {interruptedRunDetected && !isBusy ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-[18px] border border-[#ead4ba] bg-[#fff6ea] px-3 py-2 text-sm text-[#805126] lg:mb-3 lg:gap-3 lg:px-4 lg:py-3">
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

            {conversationCreationError ? (
              <div className="mb-2 rounded-[18px] border border-[#e8b5a7] bg-[#fff1ec] px-3 py-2 text-sm text-[#9a3818] lg:mb-3 lg:px-4 lg:py-3">
                {conversationCreationError}
              </div>
            ) : null}

            {error ? (
              <div className="mb-2 rounded-[18px] border border-[#e8b5a7] bg-[#fff1ec] px-3 py-2 text-sm text-[#9a3818] lg:mb-3 lg:px-4 lg:py-3">
                {error.message}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-2 lg:space-y-4">
              <div className="flex items-start gap-2">
                <label className="block min-w-0 flex-1">
                  <span className="sr-only">输入消息</span>
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入消息..."
                    rows={MIN_TEXTAREA_ROWS}
                    className="w-full resize-none rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-3 py-2 text-[15px] leading-7 text-[#171717] outline-none transition placeholder:text-[#9f968b] focus:border-[rgba(201,106,43,0.45)] focus:bg-white lg:px-4 lg:py-2.5"
                    style={{
                      minHeight: `calc(${MIN_TEXTAREA_ROWS}lh + 1rem)`,
                      maxHeight: `calc(${MAX_TEXTAREA_ROWS}lh + 1rem)`,
                    }}
                  />
                </label>
                {isBusy ? (
                  <button
                    type="button"
                    onClick={() => void stop()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#171717] text-white transition hover:bg-[#9c5626] animate-[pulse-ring_2s_ease-in-out_infinite]"
                  >
                    <svg className="animate-[square-breathe_2s_ease-in-out_infinite]" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={draft.trim().length === 0}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#171717] text-white transition hover:bg-[#2b241d] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
                  </button>
                )}
              </div>

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
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
