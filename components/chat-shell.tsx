"use client";

import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useChat } from "@ai-sdk/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ASK_USER_QUESTION_PART_TYPE,
  ASK_USER_QUESTION_TOOL_NAME,
  type AskUserQuestionOutput,
} from "@/lib/ai/ask-user-question";
import { ArtifactPopover } from "@/components/artifact-popover";
import { ChatMessage } from "@/components/chat-message";
import { ConversationList } from "@/components/conversation-list";
import { ModuleSwitcher } from "@/components/module-switcher";
import { DEFAULT_CONVERSATION_TITLE } from "@/lib/constants";
import {
  formatCacheHitRate,
  formatCompactTokens,
  formatContextLength,
} from "@/lib/format";
import {
  ModelSelector,
  type ModelSelection,
} from "@/components/model-selector";
import {
  SessionToolSelector,
  type SessionToolItem,
} from "@/components/session-tool-selector";
import {
  agentObservabilitySchema,
  finalizeInterruptedMessage,
  getMessageTimestamp,
  isInterruptedMessage,
  parseAgentObservability,
  type ChatUIMessage,
} from "@/lib/observability";
import type { ConversationArtifact } from "@/lib/artifact-types";
import type { ProviderSettings } from "@/lib/provider-config";
// 仅取类型；`import type` 在编译期被擦除，不会把 server-only 的 persistence 真正引入客户端。
import type { ConversationSessionConfig } from "@/lib/persistence";

const starterPrompts = [
  "查看 Hacker News 当前最热门的 5 篇内容，分别总结主题、热度和网友讨论重点",
  "查一下当前国内外大模型 AI 公司有没有什么最新新闻，挑 3 条重要的总结",
  "帮我规划一个周末两天的杭州轻旅行行程，要求少走路、预算适中",
  "帮我创建 3 个待办：交水电费、预约体检、周五前整理报销材料",
];

const MIN_TEXTAREA_ROWS = 1;
const MAX_TEXTAREA_ROWS = 6;
const STREAM_RECOVERY_IDLE_MS = 120000;
const CHAT_INSTANCE_ID = "chat-shell";

/**
 * Auto-resend only when the last step contains an answered AskUserQuestion.
 *
 * Deliberately NOT the SDK's lastAssistantMessageIsCompleteWithToolCalls:
 * sendAutomaticallyWhen is also evaluated after every normal stream finish,
 * and that predicate returns true whenever the last step has only resolved
 * tool calls — which is exactly the state when the agent hits the
 * AGENT_MAX_STEPS cap, so it would auto-resend in an endless loop. Requiring
 * an AskUserQuestion part narrows the trigger to the answer-then-continue
 * flow.
 */
function lastAssistantMessageIsCompleteWithQuestionAnswers({
  messages,
}: {
  messages: ChatUIMessage[];
}) {
  const message = messages[messages.length - 1];

  if (!message || message.role !== "assistant") {
    return false;
  }

  const lastStepStartIndex = message.parts.reduce(
    (lastIndex, part, index) => (part.type === "step-start" ? index : lastIndex),
    -1,
  );
  const lastStepToolParts = message.parts
    .slice(lastStepStartIndex + 1)
    .filter((part) => part.type === "dynamic-tool" || part.type.startsWith("tool-"));

  return (
    lastStepToolParts.some((part) => part.type === ASK_USER_QUESTION_PART_TYPE) &&
    lastStepToolParts.every(
      (part) =>
        "state" in part &&
        (part.state === "output-available" || part.state === "output-error"),
    )
  );
}

type ChatShellProps = {
  initialConversationId: string | null;
  initialConversationTitle: string | null;
  initialMessages: ChatUIMessage[];
  initialSessionConfig: ConversationSessionConfig | null;
  initialArtifacts: ConversationArtifact[];
};

// 新会话 / 无已存配置时的默认：沿用全局默认模型，MCP / Skills 不收窄（全开）。
const DEFAULT_SESSION_CONFIG: ConversationSessionConfig = {
  modelProviderId: null,
  modelId: null,
  enabledMcpServerIds: null,
  enabledSkillNames: null,
};

/**
 * 按"已存配置 + 当前可用供应商"解析出要选中的模型：已存模型仍存在则用它，否则回退
 * 到全局默认（默认供应商的默认模型）。供应商/模型可能已被删除，故必须校验存在性。
 */
function resolveModelSelection(
  providers: ProviderSettings[],
  config: ConversationSessionConfig,
): ModelSelection | null {
  if (config.modelProviderId && config.modelId) {
    const provider = providers.find(
      (p) => p.id === config.modelProviderId && p.isEnabled,
    );
    const model = provider?.models.find(
      (m) => m.modelId === config.modelId && m.isEnabled,
    );

    if (provider && model) {
      return {
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.modelId,
      };
    }
  }

  const defaultProvider =
    providers.find((p) => p.isEnabled && p.isDefault) ??
    providers.find((p) => p.isEnabled);

  if (!defaultProvider) {
    return null;
  }

  const defaultModel =
    defaultProvider.models.find((m) => m.isEnabled && m.isDefault) ??
    defaultProvider.models.find((m) => m.isEnabled);

  if (!defaultModel) {
    return null;
  }

  return {
    providerId: defaultProvider.id,
    providerName: defaultProvider.name,
    modelId: defaultModel.modelId,
  };
}

/**
 * 把已存的启用清单对账成当前候选下的勾选 id：null（未收窄）→ 全选；数组 → 与现有
 * 候选取交集（丢弃已被删除的项），保证结果始终是候选的子集。
 */
function reconcileToolSelection(
  saved: string[] | null,
  items: SessionToolItem[],
): string[] {
  if (saved === null) {
    return items.map((item) => item.id);
  }

  const candidateIds = new Set(items.map((item) => item.id));
  return saved.filter((id) => candidateIds.has(id));
}

class ModelOverrideStore {
  #value: ModelSelection | null = null;

  get() {
    return this.#value;
  }

  set(value: ModelSelection | null) {
    this.#value = value;
  }
}

/**
 * 本次会话的 MCP / Skills 收窄选择，供 transport 的 prepareSendMessagesRequest 读取
 * （transport 只创建一次，拿不到最新 React state，故用可变 store 桥接）。
 * 每个字段为下发给服务端的"启用清单"：null 表示未收窄，请求里省略该字段、服务端走
 * 默认全开；数组（含空数组）表示精确启用列表。
 */
class SessionToolsStore {
  #mcpServerIds: string[] | null = null;
  #skillNames: string[] | null = null;

  getMcpServerIds() {
    return this.#mcpServerIds;
  }

  setMcpServerIds(value: string[] | null) {
    this.#mcpServerIds = value;
  }

  getSkillNames() {
    return this.#skillNames;
  }

  setSkillNames(value: string[] | null) {
    this.#skillNames = value;
  }
}

function McpIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <rect x="2" y="3" width="20" height="7" rx="2" />
      <rect x="2" y="14" width="20" height="7" rx="2" />
      <path d="M6 6.5h.01M6 17.5h.01" />
    </svg>
  );
}

function SkillsIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M12 3l1.9 4.7L18.5 9.5l-4.6 1.8L12 16l-1.9-4.7L5.5 9.5l4.6-1.8z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
    </svg>
  );
}

class ConversationIdStore {
  #value: string | null;

  constructor(initial: string | null) {
    this.#value = initial;
  }

  get() {
    return this.#value;
  }

  set(value: string | null) {
    this.#value = value;
  }
}

function StatusMetric({
  label,
  value,
  title,
  icon,
  iconClassName,
  suffix,
  muted = false,
}: {
  label?: string;
  value: string;
  title: string;
  icon?: string;
  iconClassName?: string;
  suffix?: string;
  muted?: boolean;
}) {
  return (
    <span
      className="flex items-baseline gap-1 whitespace-nowrap"
      title={title}
    >
      <span className={muted ? "text-[#8a8175]" : "text-[#352d25]"}>
        {icon ? (
          <span className={`mr-0.5 ${iconClassName ?? ""}`}>{icon}</span>
        ) : null}
        {value}
      </span>
      {suffix ? <span className="text-[#b0a496]">{suffix}</span> : null}
      {label ? (
        <span className="text-[9px] tracking-[0.12em] text-[#b0a496]">
          {label}
        </span>
      ) : null}
    </span>
  );
}

function formatShortConversationId(conversationId: string) {
  return conversationId.slice(0, 8);
}

/** 取 MCP url 的 host 作为 chip 菜单里的次要说明，解析失败则回退原串。 */
function hostFromUrl(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
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

/**
 * 仅当会话末尾那一轮被中断时才算"待恢复"。中断标记会被持久化进对应
 * assistant 消息，一旦用户继续对话、产生了更新的成功轮次，旧的中断标记
 * 就只是历史，不该再触发"上一次执行被中断"横幅——所以这里只看最后一条
 * 消息，而不是 .some() 扫描整段历史。
 */
function hasUnresolvedInterruption(chatMessages: ChatUIMessage[]) {
  const lastMessage = chatMessages[chatMessages.length - 1];
  return lastMessage ? isInterruptedMessage(lastMessage.metadata) : false;
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
  initialSessionConfig,
  initialArtifacts,
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
  const [pendingTitle, setPendingTitle] = useState<{
    conversationId: string;
    title: string;
  } | null>(null);
  const [conversationCreationError, setConversationCreationError] =
    useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<ConversationArtifact[]>(
    initialArtifacts,
  );
  const [artifactPopoverOpen, setArtifactPopoverOpen] = useState(false);
  const [interruptedRunDetected, setInterruptedRunDetected] = useState(() =>
    hasUnresolvedInterruption(initialRecoveredMessages),
  );
  const [providers, setProviders] = useState<ProviderSettings[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(null);
  const [mcpServerItems, setMcpServerItems] = useState<SessionToolItem[]>([]);
  const [skillItems, setSkillItems] = useState<SessionToolItem[]>([]);
  // 当前会话的已存配置；与候选列表一起经对账 effect 还原成下面三项选择。
  const [restoredConfig, setRestoredConfig] = useState<ConversationSessionConfig>(
    () => initialSessionConfig ?? DEFAULT_SESSION_CONFIG,
  );
  // 勾选清单由对账 effect 写入：候选或 restoredConfig 变化时重算。
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<string[]>([]);
  const [selectedSkillNames, setSelectedSkillNames] = useState<string[]>([]);
  const [modelOverrideStore] = useState(() => new ModelOverrideStore());
  const [sessionToolsStore] = useState(() => new SessionToolsStore());
  const [conversationIdStore] = useState(
    () => new ConversationIdStore(initialConversationId),
  );
  const [transport] = useState(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ body, id, messages }) => {
          const override = modelOverrideStore.get();
          const mcpServerIds = sessionToolsStore.getMcpServerIds();
          const skillNames = sessionToolsStore.getSkillNames();
          const requestConversationId = conversationIdStore.get() ?? id;
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
              ...(mcpServerIds ? { enabledMcpServerIds: mcpServerIds } : {}),
              ...(skillNames ? { enabledSkillNames: skillNames } : {}),
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
  const previousRouteConversationIdRef = useRef<string | null>(routeConversationId);
  const isResettingToNewConversationRef = useRef(false);
  const conversationId = routeConversationId ?? localConversationId;

  useEffect(() => {
    conversationIdStore.set(conversationId);
  }, [conversationIdStore, conversationId]);

  useEffect(() => {
    modelOverrideStore.set(selectedModel);
  }, [modelOverrideStore, selectedModel]);

  // 全选（= 候选总数）视为"未收窄"，下发 null 让服务端走默认全开；否则下发精确清单。
  useEffect(() => {
    sessionToolsStore.setMcpServerIds(
      selectedMcpServerIds.length < mcpServerItems.length
        ? selectedMcpServerIds
        : null,
    );
  }, [sessionToolsStore, selectedMcpServerIds, mcpServerItems.length]);

  useEffect(() => {
    sessionToolsStore.setSkillNames(
      selectedSkillNames.length < skillItems.length ? selectedSkillNames : null,
    );
  }, [sessionToolsStore, selectedSkillNames, skillItems.length]);

  // 对账：候选列表或已存配置变化时（应用启动加载完候选、或切换会话）重算三项选择。
  // 用 React 官方的"渲染期按来源调整 state"模式（prev 守卫）而非 effect——避免 effect
  // 内同步 setState 的级联渲染。仅当这三个来源的引用变化时重算，因此用户在会话内的手动
  // 改动（只改 selected* 自身）不会触发重算、不会被覆盖。
  const [reconcileSources, setReconcileSources] = useState<{
    providers: ProviderSettings[];
    mcpServerItems: SessionToolItem[];
    skillItems: SessionToolItem[];
    restoredConfig: ConversationSessionConfig;
  } | null>(null);

  if (
    reconcileSources === null ||
    reconcileSources.providers !== providers ||
    reconcileSources.mcpServerItems !== mcpServerItems ||
    reconcileSources.skillItems !== skillItems ||
    reconcileSources.restoredConfig !== restoredConfig
  ) {
    setReconcileSources({ providers, mcpServerItems, skillItems, restoredConfig });
    setSelectedModel(resolveModelSelection(providers, restoredConfig));
    setSelectedMcpServerIds(
      reconcileToolSelection(restoredConfig.enabledMcpServerIds, mcpServerItems),
    );
    setSelectedSkillNames(
      reconcileToolSelection(restoredConfig.enabledSkillNames, skillItems),
    );
  }

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
    let cancelled = false;

    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;

        const settingsProviders: ProviderSettings[] =
          data.settings?.providers ?? [];
        setProviders(settingsProviders);

        // 本次会话的 MCP 候选 = 设置里全局已启用的服务；勾选交由对账 effect 还原。
        const enabledMcpServers = (
          (data.settings?.mcpServers ?? []) as Array<{
            id: string;
            name: string;
            url: string;
            isEnabled: boolean;
          }>
        ).filter((server) => server.isEnabled);
        setMcpServerItems(
          enabledMcpServers.map((server) => ({
            id: server.id,
            name: server.name,
            secondary: hostFromUrl(server.url),
          })),
        );

        // Skills 候选 = 文件系统发现 - 全局禁用名单；勾选交由对账 effect 还原。
        const disabledSkillNames = new Set<string>(
          data.settings?.disabledSkills ?? [],
        );
        fetch("/api/skills")
          .then((res) => res.json())
          .then((skillData) => {
            if (cancelled) return;

            const candidates = (
              (skillData.skills ?? []) as Array<{
                name: string;
                description: string;
              }>
            ).filter((skill) => !disabledSkillNames.has(skill.name));
            setSkillItems(
              candidates.map((skill) => ({
                id: skill.name,
                name: skill.name,
                secondary: skill.description,
              })),
            );
          })
          .catch((err) => console.error("Failed to load skills:", err));
      })
      .catch((err) => console.error("Failed to load model settings:", err));

    return () => {
      cancelled = true;
    };
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
    addToolOutput,
  } =
    useChat<ChatUIMessage>({
      id: CHAT_INSTANCE_ID,
      messages: currentMessages,
      messageMetadataSchema: agentObservabilitySchema,
      transport,
      sendAutomaticallyWhen: ({ messages }) =>
        lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
        lastAssistantMessageIsCompleteWithQuestionAnswers({ messages }),
    });

  useEffect(() => {
    const previousRouteConversationId = previousRouteConversationIdRef.current;
    previousRouteConversationIdRef.current = routeConversationId;

    if (routeConversationId === null) {
      if (
        previousRouteConversationId !== null ||
        isResettingToNewConversationRef.current
      ) {
        isResettingToNewConversationRef.current = false;
        conversationIdStore.set(null);
        setLocalConversationId(null);
        setConversationTitle(null);
        setCurrentMessages([]);
        setMessages([]);
        setInterruptedRunDetected(false);
        setRestoredConfig(DEFAULT_SESSION_CONFIG);
        setArtifacts([]);
        setArtifactPopoverOpen(false);
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
            setPendingTitle(null);
            setCurrentMessages(recoveredMessages);
            setMessages(recoveredMessages);
            setInterruptedRunDetected(
              hasUnresolvedInterruption(recoveredMessages),
            );
            setRestoredConfig(
              data.conversation.sessionConfig ?? DEFAULT_SESSION_CONFIG,
            );
            setArtifacts(data.conversation.artifacts ?? []);
          } else {
            setConversationTitle(null);
            setPendingTitle(null);
            setCurrentMessages([]);
            setMessages([]);
            setInterruptedRunDetected(false);
            setRestoredConfig(DEFAULT_SESSION_CONFIG);
            setArtifacts([]);
            setArtifactPopoverOpen(false);
          }
        })
        .catch((fetchError) => {
          if (cancelled || isResettingToNewConversationRef.current) {
            return;
          }

          console.error("Failed to load conversation:", fetchError);
          setLocalConversationId(routeConversationId);
          setConversationTitle(null);
          setPendingTitle(null);
          setCurrentMessages([]);
          setMessages([]);
          setInterruptedRunDetected(false);
          setRestoredConfig(DEFAULT_SESSION_CONFIG);
          setArtifacts([]);
          setArtifactPopoverOpen(false);
        });

      return () => {
        cancelled = true;
      };
    }
  }, [conversationIdStore, localConversationId, routeConversationId, setMessages]);

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
  // 供稳定回调读取最新值，避免把 messages / isBusy 写进依赖导致
  // 每个流式 chunk 都生成新回调、击穿 ChatMessage 的 memo。
  const isBusyRef = useRef(isBusy);
  const messagesRef = useRef(messages);

  useEffect(() => {
    isBusyRef.current = isBusy;
  }, [isBusy]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const wasBusy = prevIsBusyRef.current;
    prevIsBusyRef.current = isBusy;

    // Refresh sidebar on any isBusy transition (start or end of chat)
    if (wasBusy !== isBusy) {
      setSidebarRefreshCounter((c) => c + 1);
    }

    // Only proceed when chat just finished (busy → idle)
    if (!wasBusy || isBusy) return;

    const cid = conversationIdStore.get();
    if (cid) {
      fetch(`/api/conversations/${encodeURIComponent(cid)}/artifacts`)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error("Failed to load artifacts.");
          }

          const payload = (await response.json()) as {
            artifacts?: ConversationArtifact[];
          };
          setArtifacts(payload.artifacts ?? []);
        })
        .catch((artifactError) => {
          console.error("Failed to refresh artifacts:", artifactError);
        });
    }

    // If this isn't the first exchange, no need to poll for title
    const userCount = messages.filter((m) => m.role === "user").length;
    const assistantCount = messages.filter((m) => m.role === "assistant").length;
    if (!cid || userCount !== 1 || assistantCount !== 1) return;
    const titleConversationId = cid;

    // Poll until the DB title changes (temp title from first message → LLM title).
    // Fetch immediately to capture baseline before LLM finishes, then poll every 2s.
    const POLL_INTERVAL = 2000;
    const MAX_ATTEMPTS = 15;
    let attempt = 0;
    let baselineTitle: string | null = null;
    let done = false;
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`/api/conversations/${titleConversationId}`);
        if (res.ok && !done && !cancelled) {
          const { conversation } = await res.json();
          const title: string | null = conversation?.title || null;

          if (baselineTitle === null) {
            baselineTitle = title;
          } else if (title && title !== baselineTitle) {
            setPendingTitle({
              conversationId: titleConversationId,
              title,
            });
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
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversationIdStore, conversationId, isBusy, messages]);

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
  /**
   * 把当前内存中的消息按"流已死"整理一遍：补结束 metadata、settle 悬空
   * 工具 part。用于用户主动停止、流错误与发送新消息前——否则被打断的
   * 工具行会一直显示假"运行中"，直到刷新页面。
   */
  const recoverDeadStream = useCallback(() => {
    const recovered = normalizeRecoveredMessages(messagesRef.current);
    setCurrentMessages(recovered);
    setMessages(recovered);
    setInterruptedRunDetected(
      (prev) => prev || hasUnresolvedInterruption(recovered),
    );
  }, [setMessages]);

  const handleStop = useCallback(async () => {
    await stop();
    // 等 SDK 把中止后的最终消息状态刷进 React，再做整理。
    window.setTimeout(recoverDeadStream, 0);
  }, [recoverDeadStream, stop]);

  useEffect(() => {
    if (status !== "error") {
      return;
    }

    recoverDeadStream();
  }, [recoverDeadStream, status]);

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
  const tokenTotals = messages.reduce(
    (totals, message) => {
      const observability = parseAgentObservability(message.metadata);
      if (!observability) {
        return totals;
      }

      for (const step of observability.timeline) {
        totals.inputTokens += step.usage.inputTokens;
        totals.outputTokens += step.usage.outputTokens;
        totals.cachedInputTokens += step.usage.cachedInputTokens;
      }

      return totals;
    },
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  );
  const cacheHitRate =
    tokenTotals.inputTokens > 0
      ? tokenTotals.cachedInputTokens / tokenTotals.inputTokens
      : null;
  const displayConversationTitle = conversationTitle || DEFAULT_CONVERSATION_TITLE;

  function scrollToBottom() {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    }
  }

  async function ensureConversationId() {
    const existingConversationId = conversationIdStore.get();
    if (existingConversationId) {
      return existingConversationId;
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

      conversationIdStore.set(nextConversationId);
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
    // 先把内存里可能残留的悬空工具 part 整理成与服务端 settle 一致的
    // 终态，避免发送后旧消息还显示假"运行中"徽标。
    recoverDeadStream();
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

  const handleRegenerateFromMessage = useCallback(
    async (messageId: string) => {
      if (isBusyRef.current) {
        return;
      }

      const messagesSnapshot = messagesRef.current;
      const assistantIndex = messagesSnapshot.findIndex(
        (message) => message.id === messageId,
      );

      if (assistantIndex <= 0) {
        return;
      }

      const userIndex = [...messagesSnapshot]
        .slice(0, assistantIndex)
        .map((message, index) => ({ message, index }))
        .reverse()
        .find(({ message }) => message.role === "user")?.index;

      if (userIndex === undefined) {
        return;
      }

      const userText = extractMessageText(messagesSnapshot[userIndex]);

      if (!userText) {
        return;
      }

      const nextMessages = messagesSnapshot.slice(0, userIndex);
      flushSync(() => {
        setCurrentMessages(nextMessages);
        setMessages(nextMessages);
      });
      clearError();
      setConversationCreationError(null);
      setInterruptedRunDetected(false);
      await sendMessage({ text: userText });
    },
    [clearError, sendMessage, setMessages],
  );

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

  // 用户主动忽略中断横幅：先乐观隐藏，再把末轮的 interrupted 标记从持久化里
  // 清掉，使其刷新后也不再出现。无会话 id（极少见）时只做本地隐藏。
  async function handleDismissInterruption() {
    setInterruptedRunDetected(false);

    const targetConversationId = conversationId;
    if (!targetConversationId) {
      return;
    }

    try {
      await fetch(
        `/api/conversations/${targetConversationId}/dismiss-interruption`,
        { method: "POST" },
      );
    } catch (dismissError) {
      console.error("Failed to dismiss interruption:", dismissError);
    }
  }

  const handleToolApprovalResponse = useCallback(
    async (approvalId: string, approved: boolean) => {
      if (isBusyRef.current) {
        return;
      }

      clearError();
      await addToolApprovalResponse({
        id: approvalId,
        approved,
        reason: approved ? "用户已允许执行此命令。" : "用户拒绝执行此命令。",
      });
    },
    [addToolApprovalResponse, clearError],
  );

  const handleQuestionAnswer = useCallback(
    async (toolCallId: string, output: AskUserQuestionOutput) => {
      if (isBusyRef.current) {
        return;
      }

      clearError();
      await addToolOutput({
        tool: ASK_USER_QUESTION_TOOL_NAME,
        toolCallId,
        output,
      });
    },
    [addToolOutput, clearError],
  );

  function handleNewConversation() {
    if (isCreatingConversation) {
      return;
    }

    if (!conversationId && messages.length === 0) {
      return;
    }

    isResettingToNewConversationRef.current = true;
    conversationIdStore.set(null);
    setConversationCreationError(null);
    setConversationTitle(null);
    setPendingTitle(null);
    setCurrentMessages([]);
    setMessages([]);
    setInterruptedRunDetected(false);
    setRestoredConfig(DEFAULT_SESSION_CONFIG);
    setArtifacts([]);
    setArtifactPopoverOpen(false);
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
                onConversationSelect={() => setSidebarOpen(false)}
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
            className={`absolute inset-x-0 top-0 z-20 border-b border-[rgba(23,23,23,0.06)] bg-[rgba(255,252,247,0.62)] backdrop-blur-xl backdrop-saturate-150 transition-transform duration-200 ease-out will-change-transform lg:translate-y-0 ${
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
                  {conversationId ? (
                    <ArtifactPopover
                      conversationId={conversationId}
                      artifacts={artifacts}
                      open={artifactPopoverOpen}
                      onOpenChange={setArtifactPopoverOpen}
                    />
                  ) : null}
                </div>
              </div>

              <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-[rgba(23,23,23,0.08)] pt-2.5 font-mono text-[11px] leading-none text-[#5c544a] sm:flex lg:w-auto lg:justify-end lg:border-t-0 lg:pt-0">
                <StatusMetric
                  label="CTX"
                  value={formatCompactTokens(currentContextLength)}
                  title={`当前上下文长度：${formatContextLength(currentContextLength)} tokens`}
                />
                <StatusMetric
                  icon="↑"
                  iconClassName="text-[#7f9b5a]"
                  value={formatCompactTokens(tokenTotals.inputTokens)}
                  title={`累计输入：${formatContextLength(tokenTotals.inputTokens)} tokens`}
                />
                <StatusMetric
                  icon="↓"
                  iconClassName="text-[#c96a2b]"
                  value={formatCompactTokens(tokenTotals.outputTokens)}
                  title={`累计输出：${formatContextLength(tokenTotals.outputTokens)} tokens`}
                />
                <StatusMetric
                  label="CACHE"
                  value={`${formatCacheHitRate(cacheHitRate)}${cacheHitRate === null ? "" : "%"}`}
                  suffix={
                    tokenTotals.cachedInputTokens > 0
                      ? formatCompactTokens(tokenTotals.cachedInputTokens)
                      : undefined
                  }
                  title={`缓存命中率 ${formatCacheHitRate(cacheHitRate)}${cacheHitRate === null ? "" : "%"} · 命中 ${formatContextLength(tokenTotals.cachedInputTokens)} tokens`}
                />

                <span
                  aria-hidden
                  className="h-3 w-px self-center bg-[rgba(23,23,23,0.14)]"
                />

                <StatusMetric
                  muted
                  label="MSG"
                  value={String(messages.length)}
                  title="消息数"
                />
                <StatusMetric
                  muted
                  label="TOOL"
                  value={String(toolStepCount)}
                  title="工具调用步数"
                />
                <StatusMetric
                  muted
                  label="TURN"
                  value={String(userMessageCount)}
                  title="用户输入轮次"
                />
              </div>
            </div>
            </div>
          </header>

          <div
            ref={scrollContainerRef}
            className="relative flex-1 overflow-y-auto px-4 pb-4 pt-[calc(var(--header-h,3.5rem)+1rem)]"
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
                        onRegenerate={handleRegenerateFromMessage}
                        onToolApprovalResponse={handleToolApprovalResponse}
                        onQuestionAnswer={handleQuestionAnswer}
                        questionInteractionEnabled={isLastMessage && !isBusy}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="relative border-t border-[rgba(23,23,23,0.08)] bg-[rgba(255,250,244,0.92)] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:px-4 lg:py-4 lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
            {interruptedRunDetected && !isBusy ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-[18px] border border-[#ead4ba] bg-[#fff6ea] px-3 py-2 text-sm text-[#805126] lg:mb-3 lg:gap-3 lg:px-4 lg:py-3">
                <span>检测到上一次 Agent 执行被中断，当前已恢复为可继续操作状态。</span>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleReplayLatestTurn()}
                    disabled={!canReplayLatestTurn}
                    className="rounded-full border border-[#d7b38e] px-3 py-1.5 text-xs font-medium text-[#7f4218] transition hover:border-[#b86b36] hover:text-[#9c5626] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    重新生成上一条回复
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDismissInterruption()}
                    aria-label="忽略此提示"
                    title="忽略此提示"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[#a07a4f] transition hover:bg-[#f1dcc1] hover:text-[#7f4218]"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : null}

            {conversationCreationError ? (
              <div className="mb-2 rounded-[18px] border border-[#e8b5a7] bg-[#fff1ec] px-3 py-2 text-sm text-[#9a3818] lg:mb-3 lg:px-4 lg:py-3">
                {conversationCreationError}
              </div>
            ) : null}

            {error ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-[18px] border border-[#e8b5a7] bg-[#fff1ec] px-3 py-2 text-sm text-[#9a3818] lg:mb-3 lg:gap-3 lg:px-4 lg:py-3">
                <span className="min-w-0 break-words">{error.message}</span>
                <button
                  type="button"
                  onClick={() => void handleReplayLatestTurn()}
                  disabled={!canReplayLatestTurn}
                  title="丢弃本轮已产生的回复与工具结果，从最后一条消息重新生成"
                  className="shrink-0 rounded-full border border-[#d89a86] px-3 py-1.5 text-xs font-medium text-[#9a3818] transition hover:border-[#b86b36] hover:text-[#7f2f12] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  重试上一轮
                </button>
              </div>
            ) : null}

            <form onSubmit={handleSubmit}>
              <div className="rounded-2xl border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] shadow-[0_1px_2px_rgba(23,23,23,0.04)] transition-[border-color,background-color,box-shadow] duration-200 focus-within:border-[rgba(201,106,43,0.45)] focus-within:bg-white focus-within:shadow-[0_4px_18px_rgba(201,106,43,0.1)]">
                <label className="block">
                  <span className="sr-only">输入消息</span>
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入消息..."
                    rows={MIN_TEXTAREA_ROWS}
                    className="w-full resize-none bg-transparent px-3.5 pb-1.5 pt-3 text-[15px] leading-7 text-[#171717] outline-none placeholder:text-[#9f968b] lg:px-4"
                    style={{
                      minHeight: `calc(${MIN_TEXTAREA_ROWS}lh + 1.125rem)`,
                      maxHeight: `calc(${MAX_TEXTAREA_ROWS}lh + 1.125rem)`,
                    }}
                  />
                </label>

                <div className="flex items-center justify-between gap-2 px-2 pb-2 lg:px-2.5 lg:pb-2.5">
                  <div className="flex min-w-0 items-center gap-1">
                    <ModelSelector
                      providers={providers}
                      selected={selectedModel}
                      onSelect={setSelectedModel}
                      disabled={isBusy}
                    />
                    <SessionToolSelector
                      label="MCP"
                      icon={<McpIcon />}
                      items={mcpServerItems}
                      selectedIds={selectedMcpServerIds}
                      onChange={setSelectedMcpServerIds}
                      disabled={isBusy}
                      emptyHint="本次对话不会连接任何 MCP 服务"
                    />
                    <SessionToolSelector
                      label="Skills"
                      icon={<SkillsIcon />}
                      items={skillItems}
                      selectedIds={selectedSkillNames}
                      onChange={setSelectedSkillNames}
                      disabled={isBusy}
                      emptyHint="本次对话不会加载任何 Skill"
                    />
                    <span className="ml-1 hidden truncate text-[11px] text-[#b0a496] lg:inline">
                      Enter 发送 · Shift+Enter 换行
                    </span>
                  </div>
                  {isBusy ? (
                    <button
                      type="button"
                      onClick={() => void handleStop()}
                      title="停止生成"
                      aria-label="停止生成"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#171717] text-white transition hover:bg-[#9c5626] animate-[pulse-ring_2s_ease-in-out_infinite]"
                    >
                      <svg className="animate-[square-breathe_2s_ease-in-out_infinite]" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={draft.trim().length === 0}
                      title="发送消息"
                      aria-label="发送消息"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#171717] text-white transition-colors duration-200 hover:bg-[#9c5626] disabled:cursor-not-allowed disabled:bg-[rgba(23,23,23,0.07)] disabled:text-[#b3a797]"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3M4 7l4-4 4 4" /></svg>
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
