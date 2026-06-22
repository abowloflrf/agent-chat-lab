"use client";

import { type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";

export type SessionToolItem = {
  /** 稳定标识：MCP 用 server id，Skill 用 skill name。 */
  id: string;
  /** 主标签，等宽展示（服务名 / skill 名）。 */
  name: string;
  /** 次要说明：MCP 显示 url host，Skill 显示 description。 */
  secondary?: string;
};

type SessionToolSelectorProps = {
  /** chip 文案，如 "MCP" / "Skills"。 */
  label: string;
  /** chip 前缀图标（内联 SVG，描边风格）。 */
  icon: ReactNode;
  /** 候选项 = 全局已启用的范围，本选择器只在其中收窄。 */
  items: SessionToolItem[];
  /** 当前勾选的 id 列表（受控）。 */
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  /** 全部未勾选时，菜单底部给一句引导（如跳转设置）。 */
  emptyHint?: ReactNode;
  disabled?: boolean;
};

/**
 * 底部工具栏的「本次会话」多选 chip：向上弹出的暖色卡片，语义是多选——点条目
 * 只切换勾选、不关闭面板（Popover 仅在点外部/Esc 时关闭）。无候选项时整个 chip
 * 不渲染。弹层定位与溢出避让交给 Radix Popover。
 */
export function SessionToolSelector({
  label,
  icon,
  items,
  selectedIds,
  onChange,
  emptyHint,
  disabled = false,
}: SessionToolSelectorProps) {
  // 候选为空时不占位（同 ModelSelector ≤1 隐藏的思路）。
  if (items.length === 0) {
    return null;
  }

  const total = items.length;
  const selectedSet = new Set(selectedIds);
  const selectedCount = items.filter((item) => selectedSet.has(item.id)).length;
  const allSelected = selectedCount === total;
  const noneSelected = selectedCount === 0;

  // chip 三态：全选=中性灰（默认无存在感）、子集=橙色高亮+计数、全不选=灰显「关」。
  const triggerStateClass = noneSelected
    ? "text-[var(--muted-foreground)]"
    : allSelected
      ? "text-[var(--muted-foreground)]"
      : "text-[var(--accent)]";

  function toggle(id: string) {
    onChange(
      selectedSet.has(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id],
    );
  }

  function toggleAll() {
    onChange(allSelected ? [] : items.map((item) => item.id));
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={`本次会话的 ${label}`}
          className={`group inline-flex h-8 items-center gap-1.5 rounded-lg px-2 transition hover:bg-[var(--surface-muted)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 ${triggerStateClass}`}
        >
          <span className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors group-data-[state=open]:bg-[var(--surface-muted)] group-data-[state=open]:text-[var(--accent)]">
            {icon}
          </span>
          <span className="hidden font-mono text-[11px] sm:inline">{label}</span>
          {noneSelected ? (
            <span className="hidden font-mono text-[10px] text-[var(--muted-foreground)] sm:inline">关</span>
          ) : allSelected ? null : (
            <span className="hidden sm:inline-flex rounded-full bg-[var(--surface-muted)] px-1.5 font-mono text-[10px] tabular-nums text-[var(--accent)]">
              {selectedCount}/{total}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="menu-appear z-50 w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-lg shadow-black/8 sm:w-auto sm:min-w-[260px] sm:max-w-[340px]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
              本次会话 · {label}
            </span>
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-[var(--muted-foreground)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--accent)]"
            >
              {allSelected ? "全部关闭" : "全部开启"}
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto py-1 sm:max-h-[300px]">
            {items.map((item) => {
              const checked = selectedSet.has(item.id);

              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggle(item.id)}
                  className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition hover:bg-[var(--surface-muted)]"
                >
                  <span
                    className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                      checked
                        ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--primary-foreground)]"
                        : "border-[var(--border)] text-transparent"
                    }`}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      fill="none"
                      className="h-3 w-3"
                    >
                      <path
                        d="M3 8.5l3.5 3.5 6.5-7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate font-mono text-[12px] ${
                        checked ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
                      }`}
                    >
                      {item.name}
                    </span>
                    {item.secondary ? (
                      <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-[var(--muted-foreground)]">
                        {item.secondary}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          {noneSelected && emptyHint ? (
            <div className="border-t border-[var(--border)] px-3 py-2 text-[11px] leading-4 text-[var(--muted-foreground)]">
              {emptyHint}
            </div>
          ) : (
            <div className="border-t border-[var(--border)] px-3 py-1.5 text-[10px] leading-4 text-[var(--muted-foreground)]">
              未勾选的项本次对话不会加载
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
