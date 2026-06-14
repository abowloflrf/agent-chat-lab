"use client";

/**
 * Composer 顶部的三类提示条：上一次 Agent 执行被中断、创建会话失败、流式错误。
 * 纯展示：状态与回调全部由 ChatShell 透传。三条作为 fragment 并列，使其高度变化能
 * 被外层 composer 容器的 ResizeObserver（--composer-h）捕获。
 */
export function InterruptionBanner({
  interruptedRunDetected,
  isBusy,
  canReplayLatestTurn,
  conversationCreationError,
  error,
  onReplayLatestTurn,
  onDismissInterruption,
}: {
  interruptedRunDetected: boolean;
  isBusy: boolean;
  canReplayLatestTurn: boolean;
  conversationCreationError: string | null;
  error: Error | undefined;
  onReplayLatestTurn: () => void | Promise<void>;
  onDismissInterruption: () => void | Promise<void>;
}) {
  return (
    <>
      {interruptedRunDetected && !isBusy ? (
        <div className="pointer-events-auto mb-2 flex items-center justify-between gap-2 rounded-[18px] border border-[#ead4ba] bg-[#fff6ea] px-3 py-2 text-sm text-[#805126] lg:mb-3 lg:gap-3 lg:px-4 lg:py-3">
          <span>检测到上一次 Agent 执行被中断，当前已恢复为可继续操作状态。</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void onReplayLatestTurn()}
              disabled={!canReplayLatestTurn}
              className="rounded-full border border-[#d7b38e] px-3 py-1.5 text-xs font-medium text-[#7f4218] transition hover:border-[#b86b36] hover:text-[#9c5626] disabled:cursor-not-allowed disabled:opacity-50"
            >
              重新生成上一条回复
            </button>
            <button
              type="button"
              onClick={() => void onDismissInterruption()}
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
        <div className="pointer-events-auto mb-2 rounded-[18px] border border-[#e8b5a7] bg-[#fff1ec] px-3 py-2 text-sm text-[#9a3818] lg:mb-3 lg:px-4 lg:py-3">
          {conversationCreationError}
        </div>
      ) : null}

      {error ? (
        <div className="pointer-events-auto mb-2 flex items-center justify-between gap-2 rounded-[18px] border border-[#e8b5a7] bg-[#fff1ec] px-3 py-2 text-sm text-[#9a3818] lg:mb-3 lg:gap-3 lg:px-4 lg:py-3">
          <span className="min-w-0 break-words">{error.message}</span>
          <button
            type="button"
            onClick={() => void onReplayLatestTurn()}
            disabled={!canReplayLatestTurn}
            title="丢弃本轮已产生的回复与工具结果，从最后一条消息重新生成"
            className="shrink-0 rounded-full border border-[#d89a86] px-3 py-1.5 text-xs font-medium text-[#9a3818] transition hover:border-[#b86b36] hover:text-[#7f2f12] disabled:cursor-not-allowed disabled:opacity-50"
          >
            重试上一轮
          </button>
        </div>
      ) : null}
    </>
  );
}
