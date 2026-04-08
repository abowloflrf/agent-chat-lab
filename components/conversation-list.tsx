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
  refreshTrigger?: string | number;
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
    }
    if (minutes < 60) {
      return `${minutes} 分钟前`;
    }
    if (hours < 24) {
      return `${hours} 小时前`;
    }
    if (days < 7) {
      return `${days} 天前`;
    }

    return date.toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div>
        <button
          type="button"
          onClick={onNewConversation}
          disabled={isCreatingConversation}
          className="flex w-full cursor-pointer items-center justify-center rounded-full border border-[#f0dfcf]/14 bg-[#f3e5d7] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#2d2219] transition duration-200 hover:-translate-y-px hover:border-[#f3dfcf]/28 hover:bg-[#fbf2e8] disabled:cursor-not-allowed disabled:opacity-50"
          suppressHydrationWarning
        >
          {isCreatingConversation ? "Creating..." : "NEW CHAT"}
        </button>
      </div>

      <div className="scrollbar-hidden mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {isLoading ? (
          <div className="border-t border-white/8 py-4 text-sm text-[#a99b8a]">
            正在读取会话...
          </div>
        ) : conversations.length === 0 ? (
          <div className="border-t border-white/8 py-4 text-sm text-[#a99b8a]">
            还没有历史会话，直接从右侧发起第一轮对话。
          </div>
        ) : (
          <ul>
            {conversations.map((conversation) => {
              const active = conversation.id === currentConversationId;

              return (
                <li key={conversation.id} className="border-t border-white/8">
                  <div
                    onClick={() => handleClick(conversation.id)}
                    className={`group flex items-start justify-between gap-3 rounded-lg px-2 py-3 transition ${
                      active ? "cursor-default" : "cursor-pointer"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full transition ${
                            active ? "bg-[#d28042]" : "bg-white/20"
                          }`}
                        />
                        <p
                          className={`truncate text-sm transition ${
                            active
                              ? "text-[#fff6ee]"
                              : "text-[#dacdbf] group-hover:text-white"
                          }`}
                        >
                          {conversation.title || "未命名会话"}
                        </p>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-[#9f9180]">
                        <span>{formatTime(conversation.lastMessageAt)}</span>
                        <span className="font-mono">{conversation.id.slice(0, 6)}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(event) => handleDelete(event, conversation.id)}
                      className="rounded-full p-1.5 text-[#9f9180] opacity-0 transition hover:bg-[#5c2418] hover:text-[#ffd8ca] group-hover:opacity-100"
                      title="删除会话"
                    >
                      <svg
                        className="h-3.5 w-3.5"
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
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
