"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
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

const INITIAL_VISIBLE_COUNT = 20;
const LOAD_MORE_COUNT = 10;
const SEARCH_DEBOUNCE_MS = 240;
const SEARCH_THROTTLE_MS = 180;

export function ConversationList({
  currentConversationId,
  onNewConversation,
  refreshTrigger,
  isCreatingConversation = false,
}: ConversationListProps) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [showLoadMore, setShowLoadMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceTimeoutRef = useRef<number | null>(null);
  const throttleTimeoutRef = useRef<number | null>(null);
  const lastSearchCommitRef = useRef(0);
  const activeRequestRef = useRef(0);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = deferredSearchQuery.trim();

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current);
      }

      if (throttleTimeoutRef.current !== null) {
        window.clearTimeout(throttleTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  useEffect(() => {
    if (debounceTimeoutRef.current !== null) {
      window.clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = window.setTimeout(() => {
      const nextQuery = searchInput.trim();
      const now = Date.now();
      const elapsed = now - lastSearchCommitRef.current;

      if (elapsed >= SEARCH_THROTTLE_MS) {
        lastSearchCommitRef.current = now;
        setSearchQuery(nextQuery);
        return;
      }

      if (throttleTimeoutRef.current !== null) {
        window.clearTimeout(throttleTimeoutRef.current);
      }

      throttleTimeoutRef.current = window.setTimeout(() => {
        lastSearchCommitRef.current = Date.now();
        setSearchQuery(nextQuery);
      }, SEARCH_THROTTLE_MS - elapsed);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [searchInput]);

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    const updateLoadMoreVisibility = () => {
      const distanceToBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const isNearBottom = distanceToBottom <= 24;

      setShowLoadMore(hasMoreConversations && isNearBottom);
    };

    updateLoadMoreVisibility();
    container.addEventListener("scroll", updateLoadMoreVisibility);
    window.addEventListener("resize", updateLoadMoreVisibility);

    return () => {
      container.removeEventListener("scroll", updateLoadMoreVisibility);
      window.removeEventListener("resize", updateLoadMoreVisibility);
    };
  }, [conversations.length, hasMoreConversations]);

  const loadConversations = useCallback(async ({
    reset,
    query,
    offset,
  }: {
    reset: boolean;
    query: string;
    offset: number;
  }) => {
    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;

    if (reset) {
      setIsLoading(true);
      setIsLoadingMore(false);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const searchParams = new URLSearchParams({
        limit: String(reset ? INITIAL_VISIBLE_COUNT : LOAD_MORE_COUNT),
        offset: String(offset),
      });

      if (query) {
        searchParams.set("query", query);
      }

      const res = await fetch(`/api/conversations?${searchParams.toString()}`);

      if (!res.ok) {
        throw new Error(`Request failed: ${res.status}`);
      }

      const data = await res.json();

      if (requestId !== activeRequestRef.current) {
        return;
      }

      setConversations((current) =>
        reset ? data.conversations : [...current, ...data.conversations],
      );
      setHasMoreConversations(Boolean(data.hasMore));
    } catch (error) {
      console.error("Failed to load conversations:", error);
      if (requestId === activeRequestRef.current && reset) {
        setConversations([]);
        setHasMoreConversations(false);
      }
    } finally {
      if (requestId === activeRequestRef.current) {
        if (reset) {
          setIsLoading(false);
        } else {
          setIsLoadingMore(false);
        }
      }
    }
  }, []);

  useEffect(() => {
    void loadConversations({ reset: true, query: normalizedSearchQuery, offset: 0 });
  }, [loadConversations, normalizedSearchQuery, refreshTrigger]);

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
        await loadConversations({
          reset: true,
          query: normalizedSearchQuery,
          offset: 0,
        });
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

  function toggleSearch() {
    setIsSearchOpen((current) => {
      if (current) {
        setSearchInput("");
        setSearchQuery("");
      }

      return !current;
    });
  }

  function handleLoadMore() {
    if (isLoadingMore || !hasMoreConversations) {
      return;
    }

    void loadConversations({
      reset: false,
      query: normalizedSearchQuery,
      offset: conversations.length,
    });
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
      <div className="flex items-center gap-2">
        {isSearchOpen ? (
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-[#f0dfcf]/14 bg-[#f3e5d7] px-3 py-2 text-[#2d2219]">
            <svg
              className="h-3.5 w-3.5 shrink-0 text-[#7a6654]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
              />
            </svg>
            <input
              ref={searchInputRef}
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索历史会话"
              className="w-full min-w-0 bg-transparent text-[11px] font-medium tracking-[0.12em] text-[#2d2219] uppercase placeholder:text-[#7a6654] focus:outline-none"
            />
          </label>
        ) : (
          <button
            type="button"
            onClick={onNewConversation}
            disabled={isCreatingConversation}
            className="flex flex-1 cursor-pointer items-center justify-center rounded-full border border-[#f0dfcf]/14 bg-[#f3e5d7] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-[#2d2219] transition duration-200 hover:-translate-y-px hover:border-[#f3dfcf]/28 hover:bg-[#fbf2e8] disabled:cursor-not-allowed disabled:opacity-50"
            suppressHydrationWarning
          >
            {isCreatingConversation ? "Creating..." : "NEW CHAT"}
          </button>
        )}

        <button
          type="button"
          onClick={toggleSearch}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition duration-200 ${
            isSearchOpen
              ? "border-[#f3dfcf]/28 bg-[#f3e5d7] text-[#2d2219]"
              : "border-white/10 bg-white/[0.04] text-[#dacdbf] hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
          }`}
          title={isSearchOpen ? "关闭搜索" : "搜索历史会话"}
          aria-label={isSearchOpen ? "关闭搜索" : "搜索历史会话"}
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
              d="m21 21-4.35-4.35m1.85-5.15a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
            />
          </svg>
        </button>
      </div>

      <div
        ref={scrollContainerRef}
        className="scrollbar-hidden mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
      >
        {isLoading ? (
          <div className="border-t border-white/8 py-4 text-sm text-[#a99b8a]">
            正在读取会话...
          </div>
        ) : conversations.length === 0 ? (
          <div className="border-t border-white/8 py-4 text-sm text-[#a99b8a]">
            {normalizedSearchQuery
              ? "没有匹配的历史会话，试试别的标题关键字。"
              : "还没有历史会话，直接从右侧发起第一轮对话。"}
          </div>
        ) : (
          <>
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

            {showLoadMore ? (
              <div className="border-t border-white/8 py-3">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="w-full rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-[#dacdbf] transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                >
                  {isLoadingMore ? "正在加载..." : "查看更多"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
