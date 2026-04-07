"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ConversationSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
};

type ConversationListProps = {
  currentConversationId: string;
  onNewConversation: () => void;
  refreshTrigger?: number;
  isCreatingConversation?: boolean;
};

export function ConversationList({
  currentConversationId,
  onNewConversation,
  refreshTrigger,
  isCreatingConversation = false,
}: ConversationListProps) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadConversations();
  }, [refreshTrigger]);

  async function loadConversations() {
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      setConversations(data.conversations);
    } catch (error) {
      console.error("Failed to load conversations:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(
    event: React.MouseEvent<HTMLButtonElement>,
    conversationId: string,
  ) {
    event.stopPropagation();
    event.preventDefault();

    if (!confirm("确定要删除这个会话吗？此操作不可恢复。")) {
      return;
    }

    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await loadConversations();
        if (conversationId === currentConversationId) {
          onNewConversation();
        }
      }
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  }

  function handleClick(conversationId: string) {
    if (conversationId !== currentConversationId) {
      router.push(`/?conversationId=${conversationId}`);
    }
  }

  function formatTime(isoString: string) {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) {
      return "刚刚";
    } else if (minutes < 60) {
      return `${minutes} 分钟前`;
    } else if (hours < 24) {
      return `${hours} 小时前`;
    } else if (days < 7) {
      return `${days} 天前`;
    } else {
      return date.toLocaleDateString("zh-CN", {
        month: "short",
        day: "numeric",
      });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
          会话列表
        </h2>
        <button
          type="button"
          onClick={onNewConversation}
          disabled={isCreatingConversation}
          className="rounded-md border border-black/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-slate-700 transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
          suppressHydrationWarning
        >
          {isCreatingConversation ? "新建中..." : "新建会话"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="py-4 text-center text-sm text-slate-500">
            加载中...
          </div>
        ) : conversations.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-500">
            暂无会话
          </div>
        ) : (
          <ul className="space-y-1">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <div
                  onClick={() => handleClick(conversation.id)}
                  className={`group flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                    conversation.id === currentConversationId
                      ? "border-orange-200 bg-orange-50"
                      : "border-black/10 bg-white/70 hover:bg-white"
                  } ${conversation.id !== currentConversationId ? "cursor-pointer" : ""}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {conversation.title || "未命名会话"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatTime(conversation.lastMessageAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, conversation.id)}
                    className="ml-2 hidden rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600 group-hover:block"
                    title="删除会话"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
