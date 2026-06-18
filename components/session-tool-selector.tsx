"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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
 * 底部工具栏的「本次会话」多选 chip：与 ModelSelector 同构（向上弹出、暖色卡片），
 * 但语义是多选——点条目只切换勾选、不关闭菜单。无候选项时整个 chip 不渲染。
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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

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
    ? "text-[#b0a496]"
    : allSelected
      ? "text-[#6c6156]"
      : "text-[#9c5626]";

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
    // 移动端故意不做定位上下文（static），让弹层锚定到外层 composer 的 relative 容器、
    // 横跨输入框宽度，避免最右侧 chip 的弹层溢出屏幕；sm+ 恢复贴着 chip 弹出。
    <div ref={containerRef} className="sm:relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`本次会话的 ${label}`}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 transition hover:bg-[rgba(23,23,23,0.05)] hover:text-[#9c5626] disabled:cursor-not-allowed disabled:opacity-50 ${triggerStateClass}`}
      >
        <span className={`shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors ${open ? "bg-[rgba(201,106,43,0.12)] text-[#9c5626]" : ""}`}>{icon}</span>
        <span className="hidden font-mono text-[11px] sm:inline">{label}</span>
        {noneSelected ? (
          <span className="hidden font-mono text-[10px] text-[#b0a496] sm:inline">关</span>
        ) : allSelected ? null : (
          <span className="hidden sm:inline-flex rounded-full bg-[rgba(201,106,43,0.12)] px-1.5 font-mono text-[10px] tabular-nums text-[#9c5626]">
            {selectedCount}/{total}
          </span>
        )}
      </button>

      {open ? (
        <div className="menu-appear absolute inset-x-3 bottom-full z-50 mb-2 overflow-hidden rounded-xl border border-[rgba(23,23,23,0.1)] bg-white shadow-lg shadow-black/8 sm:inset-x-auto sm:left-0 sm:min-w-[260px] sm:max-w-[340px]">
          <div className="flex items-center justify-between gap-2 border-b border-[rgba(23,23,23,0.06)] px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#978b7e]">
              本次会话 · {label}
            </span>
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-[#6c6156] transition hover:bg-[rgba(201,106,43,0.08)] hover:text-[#9c5626]"
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
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  onClick={() => toggle(item.id)}
                  className="flex w-full items-start gap-2.5 px-3 py-1.5 text-left transition hover:bg-[rgba(201,106,43,0.06)]"
                >
                  <span
                    className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                      checked
                        ? "border-[#9c5626] bg-[#9c5626] text-white"
                        : "border-[rgba(23,23,23,0.22)] text-transparent"
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
                        checked ? "text-[#352d25]" : "text-[#6c6156]"
                      }`}
                    >
                      {item.name}
                    </span>
                    {item.secondary ? (
                      <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-[#9e9285]">
                        {item.secondary}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          {noneSelected && emptyHint ? (
            <div className="border-t border-[rgba(23,23,23,0.06)] px-3 py-2 text-[11px] leading-4 text-[#9e9285]">
              {emptyHint}
            </div>
          ) : (
            <div className="border-t border-[rgba(23,23,23,0.06)] px-3 py-1.5 text-[10px] leading-4 text-[#b0a496]">
              未勾选的项本次对话不会加载
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
