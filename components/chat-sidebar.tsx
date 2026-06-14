"use client";

import { ConversationList } from "@/components/conversation-list";
import { ModuleSwitcher } from "@/components/module-switcher";

/**
 * 会话列表侧边栏外壳：移动端抽屉（sidebarOpen 控制 translate）与桌面端常驻。纯展示，
 * 折叠/关闭/新建会话的副作用与竞态守卫全部由 ChatShell 经回调透传——onNewConversation
 * 本身即"新建 + 关抽屉"的复合回调，onCloseSidebar 同时服务于 ✕ 按钮与选中会话后收起。
 */
export function ChatSidebar({
  sidebarOpen,
  conversationId,
  sidebarRefreshCounter,
  isCreatingConversation,
  pendingTitle,
  onToggleCollapsed,
  onCloseSidebar,
  onNewConversation,
  onConversationTitleChange,
}: {
  sidebarOpen: boolean;
  conversationId: string | null;
  sidebarRefreshCounter: number;
  isCreatingConversation: boolean;
  pendingTitle: { conversationId: string; title: string } | null;
  onToggleCollapsed: () => void;
  onCloseSidebar: () => void;
  onNewConversation: () => void;
  onConversationTitleChange: (title: string | null) => void;
}) {
  return (
    <aside
      className={`dark-panel rise-in fixed inset-y-0 left-0 z-50 overflow-hidden transition-transform duration-200 lg:relative lg:z-auto lg:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="relative flex h-full w-[280px] flex-col border-r border-white/10 p-4 pt-[max(1rem,env(safe-area-inset-top))] lg:w-[300px]">
        <div className="border-b border-white/8 pb-4">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <ModuleSwitcher />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onToggleCollapsed}
                title="收起侧边栏"
                aria-label="收起侧边栏"
                className="hidden h-8 w-8 items-center justify-center rounded-md text-[#cabfb2] transition hover:bg-white/10 hover:text-white lg:flex"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                  <path d="m16 15-3-3 3-3" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onCloseSidebar}
                aria-label="关闭侧边栏"
                className="flex h-8 w-8 items-center justify-center rounded-md text-[#cabfb2] transition hover:bg-white/10 hover:text-white lg:hidden"
              >
                ✕
              </button>
            </div>
          </div>
        </div>

        <section className="min-h-0 flex-1 pt-4">
          <ConversationList
            currentConversationId={conversationId}
            onNewConversation={onNewConversation}
            onConversationTitleChange={onConversationTitleChange}
            onConversationSelect={onCloseSidebar}
            refreshTrigger={sidebarRefreshCounter}
            isCreatingConversation={isCreatingConversation}
            pendingTitle={pendingTitle}
          />
        </section>
      </div>
    </aside>
  );
}
