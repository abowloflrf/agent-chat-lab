"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConversationStat } from "@/lib/persistence";
import { DEFAULT_CONVERSATION_TITLE } from "@/lib/constants";
import { formatFullDateTime } from "@/lib/datetime";
import { formatCacheHitRate, formatCompactTokens, formatDataSize } from "@/lib/format";
import { formatRelativeTime } from "@/lib/todo-ui";

type LoadState = "loading" | "error" | "ready";

const DASH = "—";

async function fetchConversationStats(): Promise<ConversationStat[]> {
  const response = await fetch("/api/stats/conversations");
  const payload = (await response.json()) as {
    conversations?: ConversationStat[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "加载会话列表失败。");
  }

  return payload.conversations ?? [];
}

function toMillis(isoString: string): number {
  return new Date(isoString).getTime();
}

// 命中率 0-1 映射到红(0°)→绿(130°)色相，明度压低保证米色底上的对比度。
function cacheRateColors(rate: number): { bar: string; text: string } {
  const hue = Math.round(Math.min(1, Math.max(0, rate)) * 130);
  return {
    bar: `hsl(${hue} 62% 44%)`,
    text: `hsl(${hue} 64% 32%)`,
  };
}

export function ConversationsManager() {
  const router = useRouter();
  const [rows, setRows] = useState<ConversationStat[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingBulk, setConfirmingBulk] = useState(false);

  // 行内删除确认若未操作，几秒后自动还原。
  useEffect(() => {
    if (confirmingId === null) {
      return;
    }
    const timer = setTimeout(() => setConfirmingId(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmingId]);

  useEffect(() => {
    if (!confirmingBulk) {
      return;
    }
    const timer = setTimeout(() => setConfirmingBulk(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingBulk]);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") {
      setLoadState("loading");
    } else {
      setRefreshing(true);
    }

    try {
      const next = await fetchConversationStats();
      setRows(next);
      setSelected(new Set());
      setLoadState("ready");
    } catch {
      if (mode === "initial") {
        setLoadState("error");
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchConversationStats()
      .then((next) => {
        if (!cancelled) {
          setRows(next);
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return rows;
    }

    return rows.filter((row) =>
      (row.title ?? DEFAULT_CONVERSATION_TITLE).toLowerCase().includes(normalized),
    );
  }, [query, rows]);

  const selectedVisibleCount = useMemo(
    () => visibleRows.reduce((count, row) => (selected.has(row.id) ? count + 1 : count), 0),
    [selected, visibleRows],
  );
  const allVisibleSelected = visibleRows.length > 0 && selectedVisibleCount === visibleRows.length;

  const toggleSelect = useCallback((id: string) => {
    setConfirmingBulk(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setConfirmingBulk(false);
    setSelected((current) => {
      const next = new Set(current);
      if (visibleRows.every((row) => next.has(row.id))) {
        for (const row of visibleRows) {
          next.delete(row.id);
        }
      } else {
        for (const row of visibleRows) {
          next.add(row.id);
        }
      }
      return next;
    });
  }, [visibleRows]);

  const openConversation = useCallback(
    (id: string) => {
      router.push(`/?conversationId=${id}`);
    },
    [router],
  );

  const deleteIds = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }

      setBusy(true);
      const removed = new Set(ids);

      try {
        const response =
          ids.length === 1
            ? await fetch(`/api/conversations/${encodeURIComponent(ids[0])}`, {
                method: "DELETE",
              })
            : await fetch("/api/conversations", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids }),
              });

        if (!response.ok) {
          throw new Error("删除会话失败。");
        }

        setRows((current) => current.filter((row) => !removed.has(row.id)));
        setSelected((current) => {
          const next = new Set(current);
          for (const id of ids) {
            next.delete(id);
          }
          return next;
        });
      } catch {
        // Reload to resync if the delete failed midway.
        void load("refresh");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const deleteSelected = useCallback(() => {
    const ids = visibleRows.filter((row) => selected.has(row.id)).map((row) => row.id);
    if (ids.length === 0) {
      return;
    }
    setConfirmingBulk(false);
    void deleteIds(ids);
  }, [deleteIds, selected, visibleRows]);

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">会话管理</p>
          <p className="mt-2 text-sm leading-6 text-[#6e665d]">
            所有会话的用量与元信息，按最后对话时间倒序。点击行可打开对应会话。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load("refresh")}
          disabled={refreshing || loadState === "loading"}
          className="shrink-0 rounded-full bg-[#171717] px-4 py-1.5 text-xs font-medium text-white transition hover:bg-[#2b241d] disabled:opacity-50"
        >
          {refreshing ? "刷新中…" : "刷新"}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="按标题搜索…"
          className="h-9 w-full max-w-xs rounded-lg border border-[rgba(23,23,23,0.12)] bg-white/70 px-3 text-sm text-[#352d25] outline-none transition placeholder:text-[#a99e8f] focus:border-[rgba(201,106,43,0.45)]"
        />
        {selectedVisibleCount > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#6d6257]">已选 {selectedVisibleCount} 项</span>
            <button
              type="button"
              onClick={() => {
                if (confirmingBulk) {
                  deleteSelected();
                } else {
                  setConfirmingBulk(true);
                }
              }}
              disabled={busy}
              className={`rounded-full px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-50 ${
                confirmingBulk
                  ? "bg-[#7c2d12] hover:bg-[#651e0c]"
                  : "bg-[#9a3412] hover:bg-[#7c2d12]"
              }`}
            >
              {confirmingBulk ? `确认删除 ${selectedVisibleCount} 项？` : "删除所选"}
            </button>
          </div>
        ) : null}
        <span className="ml-auto text-xs text-[#9a8d7d]">
          共 {visibleRows.length} 个会话
          {visibleRows.length !== rows.length ? `（共 ${rows.length}）` : ""}
        </span>
      </div>

      {loadState === "loading" ? (
        <div className="py-12 text-center text-sm text-[#8a8176]">加载会话列表中…</div>
      ) : loadState === "error" ? (
        <div className="accent-line py-12 pl-4">
          <p className="text-lg font-semibold tracking-[-0.02em] text-[#352d25]">
            加载会话列表失败
          </p>
          <p className="mt-2 text-sm leading-6 text-[#6e665d]">请检查网络后重试。</p>
          <button
            type="button"
            onClick={() => void load("initial")}
            className="mt-4 rounded-full bg-[#171717] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2b241d]"
          >
            重试
          </button>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="accent-line py-12 pl-4">
          <p className="text-lg font-semibold tracking-[-0.02em] text-[#352d25]">
            没有匹配的会话
          </p>
          <p className="mt-2 text-sm leading-6 text-[#6e665d]">调整搜索条件后再试。</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-[#a0937f]">
                <th className="w-9 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="全选"
                    className="h-3.5 w-3.5 cursor-pointer accent-[#c96a2b]"
                  />
                </th>
                <th className="px-2 py-2 font-medium">标题</th>
                <th className="px-2 py-2 font-medium">最后对话</th>
                <th className="px-2 py-2 text-right font-medium">输入</th>
                <th className="px-2 py-2 text-right font-medium">输出</th>
                <th className="px-2 py-2 text-right font-medium">命中率</th>
                <th className="px-2 py-2 text-right font-medium">轮次</th>
                <th className="px-2 py-2 font-medium">模型</th>
                <th className="px-2 py-2 text-right font-medium">上下文</th>
                <th className="px-2 py-2 text-right font-medium">数据量</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const title = row.title ?? DEFAULT_CONVERSATION_TITLE;
                const createdMs = toMillis(row.createdAt);
                const lastMs = toMillis(row.lastMessageAt);
                const isSelected = selected.has(row.id);

                return (
                  <tr
                    key={row.id}
                    onClick={() => openConversation(row.id)}
                    className={`cursor-pointer border-t border-[rgba(23,23,23,0.06)] transition hover:bg-[rgba(201,106,43,0.05)] ${
                      isSelected ? "bg-[rgba(201,106,43,0.07)]" : ""
                    }`}
                  >
                    <td className="px-2 py-2.5" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(row.id)}
                        aria-label={`选择 ${title}`}
                        className="h-3.5 w-3.5 cursor-pointer accent-[#c96a2b]"
                      />
                    </td>
                    <td className="max-w-[260px] px-2 py-2.5">
                      <span className="block truncate font-medium text-[#241c15]" title={title}>
                        {title}
                      </span>
                    </td>
                    <td
                      className="whitespace-nowrap px-2 py-2.5 text-[#6d6257]"
                      title={`最后对话 ${formatFullDateTime(lastMs)}\n创建于 ${formatFullDateTime(createdMs)}`}
                    >
                      {formatRelativeTime(row.lastMessageAt)}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[#53483d]">
                      {formatCompactTokens(row.inputTokens)}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[#53483d]">
                      {formatCompactTokens(row.outputTokens)}
                    </td>
                    <td className="px-2 py-2.5">
                      {row.cacheHitRate === null ? (
                        <span className="block text-right font-mono tabular-nums text-[#a0937f]">
                          {DASH}
                        </span>
                      ) : (
                        <span className="flex items-center justify-end gap-1.5">
                          <span className="h-1 w-9 shrink-0 overflow-hidden rounded-full bg-[rgba(23,23,23,0.08)]">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${Math.min(100, row.cacheHitRate * 100)}%`,
                                backgroundColor: cacheRateColors(row.cacheHitRate).bar,
                              }}
                            />
                          </span>
                          <span
                            className="font-mono tabular-nums"
                            style={{ color: cacheRateColors(row.cacheHitRate).text }}
                          >
                            {formatCacheHitRate(row.cacheHitRate)}%
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[#53483d]">
                      {row.userTurns}
                    </td>
                    <td className="max-w-[160px] px-2 py-2.5">
                      {row.lastModelId ? (
                        <span
                          className="inline-block max-w-full truncate rounded-full border border-[rgba(23,23,23,0.08)] bg-[rgba(248,242,235,0.8)] px-2 py-0.5 align-middle font-mono text-[11px] leading-4 text-[#6d6257]"
                          title={row.lastModelId}
                        >
                          {row.lastModelId}
                        </span>
                      ) : (
                        <span className="font-mono text-[12px] text-[#a0937f]">{DASH}</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[#53483d]">
                      {row.contextTokens === null ? DASH : formatCompactTokens(row.contextTokens)}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[#53483d]">
                      {formatDataSize(row.dataBytes)}
                    </td>
                    <td className="relative px-2 py-2.5 text-right" onClick={(event) => event.stopPropagation()}>
                      {/* 确认态下保留占位以免列宽/行高跳动，确认按钮以浮层覆盖。 */}
                      <button
                        type="button"
                        onClick={() => setConfirmingId(row.id)}
                        disabled={busy}
                        aria-label={`删除 ${title}`}
                        className={`rounded-md p-1 text-[#a0937f] transition hover:bg-[rgba(154,52,18,0.1)] hover:text-[#9a3412] disabled:opacity-50 ${
                          confirmingId === row.id ? "invisible" : ""
                        }`}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                      {confirmingId === row.id && (
                        <span className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-[rgba(23,23,23,0.12)] bg-white p-1 shadow-[0_4px_14px_rgba(23,23,23,0.14)]">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmingId(null);
                              void deleteIds([row.id]);
                            }}
                            disabled={busy}
                            className="rounded-full bg-[#9a3412] px-2.5 py-1 text-[11px] font-medium leading-none text-white transition hover:bg-[#7c2d12] disabled:opacity-50"
                          >
                            确认删除
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingId(null)}
                            aria-label="取消删除"
                            className="rounded-full p-1 text-[#a0937f] transition hover:bg-[rgba(23,23,23,0.06)] hover:text-[#53483d]"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
