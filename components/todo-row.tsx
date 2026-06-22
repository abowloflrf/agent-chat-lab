"use client";

import type { TodoRecord } from "@/lib/persistence";
import {
  formatRelativeTime,
  formatTime,
  nextStatus,
  priorityLabels,
  priorityMark,
  priorityMarkStyles,
  statusDotStyles,
  statusLabels,
} from "@/lib/todo-ui";

type TodoRowProps = {
  todo: TodoRecord;
  isActive: boolean;
  isPendingDelete: boolean;
  animationDelay: number;
  onOpen: () => void;
  onCycleStatus: () => void;
  onCyclePriority: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
};

export function TodoRow({
  todo,
  isActive,
  isPendingDelete,
  animationDelay,
  onOpen,
  onCycleStatus,
  onCyclePriority,
  onRequestDelete,
  onConfirmDelete,
}: TodoRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`rise-in group flex w-full cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
        isActive
          ? "border-[var(--accent)] bg-background"
          : "border-transparent hover:border-border hover:bg-[var(--glass-bg)]"
      }`}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onCycleStatus();
        }}
        title={`状态：${statusLabels[todo.status]}（点击切换到${statusLabels[nextStatus(todo.status)]}）`}
        aria-label={`状态：${statusLabels[todo.status]}，点击切换到${statusLabels[nextStatus(todo.status)]}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition hover:bg-muted"
      >
        <span
          className={`h-3 w-3 rounded-full border transition ${statusDotStyles[todo.status]}`}
        />
      </button>

      <span
        className={`min-w-0 flex-1 truncate text-[14px] font-medium tracking-[-0.02em] ${
          todo.status === "done"
            ? "text-muted-foreground line-through"
            : "text-foreground"
        }`}
      >
        {todo.title}
      </span>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onCyclePriority();
        }}
        title={`优先级：${priorityLabels[todo.priority]}（点击切换）`}
        aria-label={`优先级：${priorityLabels[todo.priority]}，点击切换`}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[12px] font-bold transition hover:bg-[var(--surface-muted)] ${priorityMarkStyles[todo.priority]}`}
      >
        {priorityMark(todo.priority) || "—"}
      </button>

      <span
        className="hidden w-16 shrink-0 text-right text-[11px] text-muted-foreground sm:block"
        title={`更新于 ${formatTime(todo.updatedAt)}`}
      >
        {formatRelativeTime(todo.updatedAt)}
      </span>

      {isPendingDelete ? (
        <button
          type="button"
          data-todo-delete
          onClick={(event) => {
            event.stopPropagation();
            onConfirmDelete();
          }}
          className="shrink-0 rounded-full border border-[var(--danger-border)] bg-[var(--danger-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--danger)] transition hover:bg-[var(--danger-surface)]"
        >
          确认删除?
        </button>
      ) : (
        <button
          type="button"
          data-todo-delete
          onClick={(event) => {
            event.stopPropagation();
            onRequestDelete();
          }}
          aria-label="删除待办"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-60 transition hover:bg-[var(--danger-surface)] hover:text-[var(--danger)] lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover:opacity-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
    </div>
  );
}
