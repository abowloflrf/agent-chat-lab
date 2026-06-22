"use client";

import type { RefObject } from "react";
import { ArtifactPopover } from "@/components/artifact-popover";
import { StatusMetrics } from "@/components/status-metrics";
import { formatShortConversationId } from "@/lib/chat-utils";
import type { ConversationArtifact } from "@/lib/artifact-types";

/**
 * 顶部栏外壳：标题、会话短 id、artifact 弹层、token 指标，以及移动端汉堡与桌面端
 * 展开侧边栏按钮。headerRef 由 ChatShell 持有（其 ResizeObserver 写 --header-h），此处
 * 仅透传给 <header>。纯展示：折叠/开抽屉/弹层开合的状态与副作用全部经回调上提。
 */
export function ChatHeader({
  headerRef,
  headerHidden,
  sidebarCollapsed,
  onToggleCollapsed,
  onOpenSidebar,
  title,
  conversationId,
  artifacts,
  artifactPopoverOpen,
  onArtifactPopoverOpenChange,
  onArtifactsChange,
  currentContextLength,
  inputTokens,
  outputTokens,
  cachedInputTokens,
  cacheHitRate,
}: {
  headerRef: RefObject<HTMLElement | null>;
  headerHidden: boolean;
  sidebarCollapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenSidebar: () => void;
  title: string;
  conversationId: string | null;
  artifacts: ConversationArtifact[];
  artifactPopoverOpen: boolean;
  onArtifactPopoverOpenChange: (open: boolean) => void;
  onArtifactsChange: (artifacts: ConversationArtifact[]) => void;
  currentContextLength: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheHitRate: number | null;
}) {
  return (
    <header
      ref={headerRef}
      className={`absolute inset-x-0 top-0 z-20 border-b border-border bg-[var(--glass-bg)] shadow-[inset_0_1px_0_var(--glass-highlight),inset_0_0_0_1px_var(--glass-edge),0_2px_8px_-3px_rgba(23,23,23,0.05)] backdrop-blur-xl backdrop-saturate-[1.8] backdrop-brightness-105 transition-transform duration-200 ease-out will-change-transform lg:translate-y-0 ${
        headerHidden ? "-translate-y-full lg:translate-y-0" : "translate-y-0"
      }`}
    >
      <div className="px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            {sidebarCollapsed ? (
              <button
                type="button"
                onClick={onToggleCollapsed}
                title="展开侧边栏"
                aria-label="展开侧边栏"
                className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-[var(--surface-muted)] lg:flex"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                  <path d="m14 9 3 3-3 3" />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              onClick={onOpenSidebar}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-[var(--surface-muted)] lg:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <p className="min-w-0 flex-1 truncate text-lg font-semibold tracking-[-0.02em] text-foreground">
              {title}
            </p>
            {conversationId ? (
              <span className="hidden shrink-0 items-center rounded-full border border-border bg-[var(--glass-bg)] px-2.5 py-1 font-mono text-[11px] text-muted-foreground sm:inline-flex">
                {formatShortConversationId(conversationId)}
              </span>
            ) : null}
            {conversationId && artifacts.length > 0 ? (
              <span className="inline-flex shrink-0">
                <ArtifactPopover
                  conversationId={conversationId}
                  artifacts={artifacts}
                  open={artifactPopoverOpen}
                  onOpenChange={onArtifactPopoverOpenChange}
                  onArtifactsChange={onArtifactsChange}
                />
              </span>
            ) : null}
          </div>
        </div>

        <StatusMetrics
          currentContextLength={currentContextLength}
          inputTokens={inputTokens}
          outputTokens={outputTokens}
          cachedInputTokens={cachedInputTokens}
          cacheHitRate={cacheHitRate}
        />
      </div>
      </div>
    </header>
  );
}
