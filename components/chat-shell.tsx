"use client";

import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useChat } from "@ai-sdk/react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import {
  ASK_USER_QUESTION_PART_TYPE,
  ASK_USER_QUESTION_TOOL_NAME,
  type AskUserQuestionOutput,
} from "@/lib/ai/ask-user-question";
import { ChatComposer } from "@/components/chat-composer";
import { ChatHeader } from "@/components/chat-header";
import { ChatMessageList } from "@/components/chat-message-list";
import { ChatSidebar } from "@/components/chat-sidebar";
import { InterruptionBanner } from "@/components/interruption-banner";
import {
  DEFAULT_CONVERSATION_TITLE,
  MAX_TEXTAREA_ROWS,
  MIN_TEXTAREA_ROWS,
} from "@/lib/constants";
import {
  extractMessageText,
  findLastUserMessageText,
  hasUnresolvedInterruption,
  hostFromUrl,
  normalizeRecoveredMessages,
  reconcileToolSelection,
  resolveModelSelection,
} from "@/lib/chat-utils";
import type { ModelSelection } from "@/components/model-selector";
import type { SessionToolItem } from "@/components/session-tool-selector";
import {
  agentObservabilitySchema,
  getMessageTimestamp,
  parseAgentObservability,
  type ChatUIMessage,
} from "@/lib/observability";
import type { ConversationArtifact } from "@/lib/artifact-types";
import type { ProviderSettings } from "@/lib/provider-config";
// 仅取类型；`import type` 在编译期被擦除，不会把 server-only 的 persistence 真正引入客户端。
import type { ConversationSessionConfig } from "@/lib/persistence";

const STREAM_RECOVERY_IDLE_MS = 120000;
const AUTO_SCROLL_THRESHOLD_PX = 80;
const CHAT_INSTANCE_ID = "chat-shell";
const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";
const SIDEBAR_COLLAPSED_EVENT = "sidebar-collapsed-change";

/**
 * 桌面端侧边栏折叠状态存于 localStorage，用 useSyncExternalStore 读取：SSR 与首帧
 * hydration 都取 server snapshot（false），hydration 完成后再同步到真实值，避免在
 * effect 里直接 setState（lint 禁止）或读 localStorage 造成的 hydration mismatch。
 * 同页写入不触发原生 storage 事件，故用自定义事件广播给所有订阅者。
 */
function subscribeSidebarCollapsed(callback: () => void) {
  window.addEventListener(SIDEBAR_COLLAPSED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(SIDEBAR_COLLAPSED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSidebarCollapsedSnapshot() {
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

function getSidebarCollapsedServerSnapshot() {
  return false;
}

function setSidebarCollapsedStorage(value: boolean) {
  window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? "1" : "0");
  window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_EVENT));
}

/**
 * 把 element 的实时高度写进 container 的某个 CSS 变量，并随 element 尺寸变化更新：
 * 先立即设一次再 observe，返回 cleanup 供 effect 卸载时 disconnect。
 */
function observeElementHeightVar(
  element: HTMLElement,
  container: HTMLElement,
  cssVarName: string,
) {
  const update = () => {
    container.style.setProperty(cssVarName, `${element.offsetHeight}px`);
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(element);
  return () => observer.disconnect();
}

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
  // 桌面端是否收起会话列表侧边栏（持久化在 localStorage）；移动端走 sidebarOpen
  // 抽屉，二者互不影响。
  const sidebarCollapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsedSnapshot,
    getSidebarCollapsedServerSnapshot,
  );
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
  const pinnedToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
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

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsedStorage(!getSidebarCollapsedSnapshot());
  }, []);

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

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    pinnedToBottomRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;

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
    return observeElementHeightVar(header, container, "--header-h");
  }, []);

  useEffect(() => {
    const composer = composerRef.current;
    const container = scrollContainerRef.current;
    if (!composer || !container) return;
    return observeElementHeightVar(composer, container, "--composer-h");
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

  // AI 回复时跟随内容自动贴底；用户向上滚动会清除 pinned 标记从而暂停，
  // 滚回底部后标记恢复、生成中继续跟随。
  useEffect(() => {
    if (!isBusy || !pinnedToBottomRef.current) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [messages, isBusy]);

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
  // 单遍历同时算出当前上下文长度与累计 token：每条消息只 parseAgentObservability
  // （zod safeParse）一次，避免流式每个 chunk 重复两遍解析。语义严格等价于原先的两次
  // reduce：currentContextLength 取各消息 step 内 inputTokens 的最大值再跨消息取最大，
  // 无 observability 的消息跳过、初值 null（区分"无数据"与"为 0"）；tokenTotals 仅累加
  // 有 observability 的消息、初值 0。
  const { currentContextLength, tokenTotals, cacheHitRate } = useMemo(() => {
    let contextLength: number | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;

    for (const message of messages) {
      const observability = parseAgentObservability(message.metadata);
      if (!observability) {
        continue;
      }

      let messageMaxInputTokens = 0;
      for (const step of observability.timeline) {
        messageMaxInputTokens = Math.max(messageMaxInputTokens, step.usage.inputTokens);
        inputTokens += step.usage.inputTokens;
        outputTokens += step.usage.outputTokens;
        cachedInputTokens += step.usage.cachedInputTokens;
      }

      contextLength =
        contextLength === null
          ? messageMaxInputTokens
          : Math.max(contextLength, messageMaxInputTokens);
    }

    return {
      currentContextLength: contextLength,
      tokenTotals: { inputTokens, outputTokens, cachedInputTokens },
      cacheHitRate: inputTokens > 0 ? cachedInputTokens / inputTokens : null,
    };
  }, [messages]);
  const displayConversationTitle = conversationTitle || DEFAULT_CONVERSATION_TITLE;

  function scrollToBottom() {
    pinnedToBottomRef.current = true;
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
      <div
        className={`grid h-full grid-cols-1 lg:transition-[grid-template-columns] lg:duration-200 lg:ease-out ${
          sidebarCollapsed
            ? "lg:grid-cols-[0px_minmax(0,1fr)]"
            : "lg:grid-cols-[300px_minmax(0,1fr)]"
        }`}
      >
        <ChatSidebar
          sidebarOpen={sidebarOpen}
          conversationId={conversationId}
          sidebarRefreshCounter={sidebarRefreshCounter}
          isCreatingConversation={isCreatingConversation}
          pendingTitle={pendingTitle}
          onToggleCollapsed={toggleSidebarCollapsed}
          onCloseSidebar={() => setSidebarOpen(false)}
          onNewConversation={() => {
            handleNewConversation();
            setSidebarOpen(false);
          }}
          onConversationTitleChange={setConversationTitle}
        />

        <section className="rise-in relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--panel)]">
          <ChatHeader
            headerRef={headerRef}
            headerHidden={headerHidden}
            sidebarCollapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebarCollapsed}
            onOpenSidebar={() => setSidebarOpen(true)}
            title={displayConversationTitle}
            conversationId={conversationId}
            artifacts={artifacts}
            artifactPopoverOpen={artifactPopoverOpen}
            onArtifactPopoverOpenChange={setArtifactPopoverOpen}
            onArtifactsChange={setArtifacts}
            currentContextLength={currentContextLength}
            inputTokens={tokenTotals.inputTokens}
            outputTokens={tokenTotals.outputTokens}
            cachedInputTokens={tokenTotals.cachedInputTokens}
            cacheHitRate={cacheHitRate}
          />

          <div
            ref={scrollContainerRef}
            className="relative flex-1 overflow-y-auto px-4 pb-[calc(var(--composer-h,7rem)+0.5rem)] pt-[calc(var(--header-h,3.5rem)+1rem)]"
          >
            <ChatMessageList
              messages={messages}
              status={status}
              isBusy={isBusy}
              onStarterPrompt={handleStarterPrompt}
              onRegenerate={handleRegenerateFromMessage}
              onToolApprovalResponse={handleToolApprovalResponse}
              onQuestionAnswer={handleQuestionAnswer}
            />
          </div>

          <div
            ref={composerRef}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3 py-2 pb-[max(0.5rem,calc(env(safe-area-inset-bottom)-8px))] lg:px-4 lg:py-4 lg:pb-[max(1rem,calc(env(safe-area-inset-bottom)-8px))]"
          >
            <InterruptionBanner
              interruptedRunDetected={interruptedRunDetected}
              isBusy={isBusy}
              canReplayLatestTurn={canReplayLatestTurn}
              conversationCreationError={conversationCreationError}
              error={error}
              onReplayLatestTurn={handleReplayLatestTurn}
              onDismissInterruption={handleDismissInterruption}
            />

            <ChatComposer
              onSubmit={handleSubmit}
              textareaRef={textareaRef}
              draft={draft}
              onDraftChange={setDraft}
              onKeyDown={handleKeyDown}
              providers={providers}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              mcpServerItems={mcpServerItems}
              selectedMcpServerIds={selectedMcpServerIds}
              onChangeMcpServerIds={setSelectedMcpServerIds}
              skillItems={skillItems}
              selectedSkillNames={selectedSkillNames}
              onChangeSkillNames={setSelectedSkillNames}
              isBusy={isBusy}
              onStop={handleStop}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
