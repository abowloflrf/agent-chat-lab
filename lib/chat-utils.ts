import {
  finalizeInterruptedMessage,
  isInterruptedMessage,
  type ChatUIMessage,
} from "@/lib/observability";
import type { ModelSelection } from "@/components/model-selector";
import type { SessionToolItem } from "@/components/session-tool-selector";
import type { ProviderSettings } from "@/lib/provider-config";
// 仅取类型；`import type` 在编译期被擦除，不会把 server-only 的 persistence 引入客户端。
import type { ConversationSessionConfig } from "@/lib/persistence";

/**
 * 按"已存配置 + 当前可用供应商"解析出要选中的模型：已存模型仍存在则用它，否则回退
 * 到全局默认（默认供应商的默认模型）。供应商/模型可能已被删除，故必须校验存在性。
 */
export function resolveModelSelection(
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
export function reconcileToolSelection(
  saved: string[] | null,
  items: SessionToolItem[],
): string[] {
  if (saved === null) {
    return items.map((item) => item.id);
  }

  const candidateIds = new Set(items.map((item) => item.id));
  return saved.filter((id) => candidateIds.has(id));
}

export function formatShortConversationId(conversationId: string) {
  return conversationId.slice(0, 8);
}

/** 取 MCP url 的 host 作为 chip 菜单里的次要说明，解析失败则回退原串。 */
export function hostFromUrl(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function extractMessageText(message: ChatUIMessage) {
  return message.parts
    .filter((part): part is Extract<ChatUIMessage["parts"][number], { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function normalizeRecoveredMessages(chatMessages: ChatUIMessage[]) {
  return chatMessages.map((message) => finalizeInterruptedMessage(message));
}

/**
 * 仅当会话末尾那一轮被中断时才算"待恢复"。中断标记会被持久化进对应
 * assistant 消息，一旦用户继续对话、产生了更新的成功轮次，旧的中断标记
 * 就只是历史，不该再触发"上一次执行被中断"横幅——所以这里只看最后一条
 * 消息，而不是 .some() 扫描整段历史。
 */
export function hasUnresolvedInterruption(chatMessages: ChatUIMessage[]) {
  const lastMessage = chatMessages[chatMessages.length - 1];
  return lastMessage ? isInterruptedMessage(lastMessage.metadata) : false;
}

/**
 * 全局最后一条 user 消息的原数组下标，无则 -1。正向倒序遍历，避免 [...messages]
 * .reverse() 的整段拷贝。注意：返回的是原数组下标，可直接用于 slice。
 */
export function findLastUserMessageIndex(messages: ChatUIMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return index;
    }
  }

  return -1;
}

/**
 * 前缀范围 [0, endExclusive) 内最后一条 user 消息的下标，无则 -1。供"从某条
 * assistant 往前找触发它的 user"场景（regenerate）使用，语义上不可与
 * findLastUserMessageIndex（全局最后一条）混用。
 */
export function findUserIndexBefore(
  messages: ChatUIMessage[],
  endExclusive: number,
): number {
  for (
    let index = Math.min(endExclusive, messages.length) - 1;
    index >= 0;
    index -= 1
  ) {
    if (messages[index].role === "user") {
      return index;
    }
  }

  return -1;
}

export function findLastUserMessageText(messages: ChatUIMessage[]) {
  const index = findLastUserMessageIndex(messages);
  return index >= 0 ? extractMessageText(messages[index]) : "";
}
