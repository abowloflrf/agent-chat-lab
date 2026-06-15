"use client";

import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { MAX_TEXTAREA_ROWS, MIN_TEXTAREA_ROWS } from "@/lib/constants";
import {
  ModelSelector,
  type ModelSelection,
} from "@/components/model-selector";
import {
  SessionToolSelector,
  type SessionToolItem,
} from "@/components/session-tool-selector";
import type { ProviderSettings } from "@/lib/provider-config";

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

/**
 * 底部输入区表单：textarea + 模型/MCP/Skills 选择 + 发送/停止按钮。textareaRef 由
 * ChatShell 持有（其 [draft] 依赖的自适应高度 effect 操作它），此处透传给 <textarea>。
 * onDraftChange/onSelectModel 等回调由 ChatShell 直传其 setter（不在此包装），以保留
 * 逐字符增高与"仅用户显式选模型时写 store"的语义。外层 composer 容器（含中断横幅）
 * 留在 ChatShell。
 */
export function ChatComposer({
  onSubmit,
  textareaRef,
  draft,
  onDraftChange,
  onKeyDown,
  providers,
  selectedModel,
  onSelectModel,
  mcpServerItems,
  selectedMcpServerIds,
  onChangeMcpServerIds,
  skillItems,
  selectedSkillNames,
  onChangeSkillNames,
  isBusy,
  onStop,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraftChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  providers: ProviderSettings[];
  selectedModel: ModelSelection | null;
  onSelectModel: (selection: ModelSelection) => void;
  mcpServerItems: SessionToolItem[];
  selectedMcpServerIds: string[];
  onChangeMcpServerIds: (selectedIds: string[]) => void;
  skillItems: SessionToolItem[];
  selectedSkillNames: string[];
  onChangeSkillNames: (selectedIds: string[]) => void;
  isBusy: boolean;
  onStop: () => void | Promise<void>;
}) {
  return (
    <form onSubmit={onSubmit} className="pointer-events-auto">
      <div className="rounded-3xl border border-[rgba(23,23,23,0.08)] bg-[var(--glass-bg)] shadow-[0_18px_28px_-2px_rgba(255,251,245,0.99),0_36px_48px_-2px_rgba(255,251,245,0.94),0_8px_30px_rgba(23,23,23,0.08),inset_0_1px_0_rgba(255,255,255,0.8),inset_0_0_0_1px_rgba(255,255,255,0.12)] backdrop-blur-xl backdrop-saturate-[1.8] backdrop-brightness-105">
        <label className="block">
          <span className="sr-only">输入消息</span>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
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
              onSelect={onSelectModel}
              disabled={isBusy}
            />
            <SessionToolSelector
              label="MCP"
              icon={<McpIcon />}
              items={mcpServerItems}
              selectedIds={selectedMcpServerIds}
              onChange={onChangeMcpServerIds}
              disabled={isBusy}
              emptyHint="本次对话不会连接任何 MCP 服务"
            />
            <SessionToolSelector
              label="Skills"
              icon={<SkillsIcon />}
              items={skillItems}
              selectedIds={selectedSkillNames}
              onChange={onChangeSkillNames}
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
              onClick={() => void onStop()}
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
  );
}
