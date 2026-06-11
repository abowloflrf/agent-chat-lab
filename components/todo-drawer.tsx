"use client";

import { useEffect, useRef } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import {
  priorityLabels,
  priorityMark,
  priorityMarkStyles,
  statusLabels,
  statusPillStyles,
  type SaveStatus,
  type TodoDraft,
} from "@/lib/todo-ui";

type TodoDrawerProps = {
  open: boolean;
  mode: "create" | "edit";
  draft: TodoDraft;
  saveStatus: SaveStatus;
  updatedAtLabel: string | null;
  isPendingDelete: boolean;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onCycleStatus: () => void;
  onCyclePriority: () => void;
  onClose: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
};

export function TodoDrawer({
  open,
  mode,
  draft,
  saveStatus,
  updatedAtLabel,
  isPendingDelete,
  onTitleChange,
  onContentChange,
  onCycleStatus,
  onCyclePriority,
  onClose,
  onRequestDelete,
  onConfirmDelete,
}: TodoDrawerProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const canDelete = mode === "edit" && draft.id !== null;

  // Close on Escape while open
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Focus the title input when creating
  useEffect(() => {
    if (open && mode === "create") {
      titleInputRef.current?.focus();
    }
  }, [open, mode]);

  return (
    <div aria-hidden={!open} className={open ? "" : "pointer-events-none"}>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-[#171717]/30 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "新建待办" : "编辑待办"}
        inert={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-[#fffaf4] shadow-[-24px_0_60px_-30px_rgba(23,23,23,0.35)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:w-[min(800px,92vw)] lg:w-[min(960px,88vw)] sm:border-l sm:border-[rgba(23,23,23,0.08)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[rgba(23,23,23,0.08)] px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            {mode === "edit" ? (
              <button
                type="button"
                onClick={onCycleStatus}
                title={`状态：${statusLabels[draft.status]}（点击切换）`}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition hover:opacity-75 ${statusPillStyles[draft.status]}`}
              >
                {statusLabels[draft.status]}
              </button>
            ) : (
              <span className="text-[11px] uppercase tracking-[0.28em] text-[#8a8176]">
                新建待办
              </span>
            )}
            <button
              type="button"
              onClick={onCyclePriority}
              title={`优先级：${priorityLabels[draft.priority]}（点击切换）`}
              aria-label={`优先级：${priorityLabels[draft.priority]}，点击切换`}
              className={`flex h-7 w-8 items-center justify-center rounded-md text-[12px] font-bold transition hover:bg-[rgba(23,23,23,0.06)] ${priorityMarkStyles[draft.priority]}`}
            >
              {priorityMark(draft.priority) || "—"}
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#8a8176] transition hover:bg-[rgba(23,23,23,0.06)] hover:text-[#5c544a]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 lg:px-8">
          <input
            ref={titleInputRef}
            value={draft.title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="例如：整理下周发布清单"
            className="w-full border-none bg-transparent px-0 py-0 text-[clamp(1.5rem,3vw,2rem)] font-bold leading-[1.12] tracking-[-0.035em] text-[#171717] outline-none placeholder:text-[#b0a395]"
          />

          <div className="mt-5 h-px bg-[rgba(23,23,23,0.08)]" />

          <div className="min-h-[320px] pt-5">
            <MarkdownEditor
              key={draft.id ?? "new"}
              value={draft.content}
              onChange={onContentChange}
              placeholder="补充上下文、验收标准或下一步动作..."
              variant="minimal"
            />
          </div>
        </div>

        <div className="border-t border-[rgba(23,23,23,0.08)] bg-[rgba(255,250,244,0.94)] px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-xs text-[#908679]">
              {updatedAtLabel ?? "新建待办"}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              {saveStatus !== "idle" ? (
                <span
                  className={`text-xs ${
                    saveStatus === "saved"
                      ? "text-[#6d8c55]"
                      : saveStatus === "error"
                        ? "text-[#9a3818]"
                        : "text-[#908679]"
                  }`}
                >
                  {saveStatus === "saved"
                    ? "已保存"
                    : saveStatus === "error"
                      ? "保存失败"
                      : "保存中..."}
                </span>
              ) : null}
              {canDelete ? (
                isPendingDelete ? (
                  <button
                    type="button"
                    data-todo-delete
                    onClick={onConfirmDelete}
                    className="rounded-full border border-[#e8b4a4] bg-[#fff1ec] px-2.5 py-1 text-[11px] font-medium text-[#9a3818] transition hover:bg-[#ffe3da]"
                  >
                    确认删除?
                  </button>
                ) : (
                  <button
                    type="button"
                    data-todo-delete
                    onClick={onRequestDelete}
                    className="text-xs text-[#9a3818] transition hover:underline"
                  >
                    删除
                  </button>
                )
              ) : null}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
