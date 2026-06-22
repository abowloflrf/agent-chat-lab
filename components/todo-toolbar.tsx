"use client";

import {
  statusLabels,
  type SaveErrorInfo,
  type TodoFilter,
} from "@/lib/todo-ui";

const filterOrder: TodoFilter[] = ["all", "todo", "in_progress", "done"];

type TodoToolbarProps = {
  filter: TodoFilter;
  counts: Record<TodoFilter, number>;
  query: string;
  saveError: SaveErrorInfo | null;
  onFilterChange: (filter: TodoFilter) => void;
  onQueryChange: (query: string) => void;
  onCreate: () => void;
  onRetrySave: () => void;
  onDismissError: () => void;
};

export function TodoToolbar({
  filter,
  counts,
  query,
  saveError,
  onFilterChange,
  onQueryChange,
  onCreate,
  onRetrySave,
  onDismissError,
}: TodoToolbarProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto">
          {filterOrder.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                filter === value
                  ? "bg-foreground text-primary-foreground"
                  : "bg-[var(--border)] text-muted-foreground hover:bg-[var(--border)]"
              }`}
            >
              {statusLabels[value]} {counts[value]}
            </button>
          ))}
        </div>

        <label className="relative min-w-[160px] flex-1">
          <span className="sr-only">搜索待办</span>
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索待办..."
            className="w-full rounded-lg border border-border bg-[var(--glass-bg)] px-3 py-1.5 pr-8 text-sm text-foreground outline-none transition placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)] focus:bg-background"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="清空搜索"
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[var(--muted-foreground)] transition hover:bg-[var(--border)] hover:text-muted-foreground"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          ) : null}
        </label>

        <button
          type="button"
          onClick={onCreate}
          className="shrink-0 rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-[var(--accent-strong)]"
        >
          新建待办
        </button>
      </div>

      {saveError ? (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-surface)] px-3 py-2 text-sm text-[var(--danger)]">
          <span className="min-w-0 flex-1">{saveError.message}</span>
          {saveError.kind === "draft" ? (
            <button
              type="button"
              onClick={onRetrySave}
              className="shrink-0 rounded-full border border-[var(--danger-border)] px-2.5 py-1 text-xs font-medium transition hover:bg-[var(--danger-surface)]"
            >
              重试
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismissError}
            aria-label="忽略错误"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition hover:bg-[var(--danger-surface)]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
