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
                  ? "bg-[#171717] text-white"
                  : "bg-[rgba(23,23,23,0.06)] text-[#5c544a] hover:bg-[rgba(23,23,23,0.1)]"
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
            className="w-full rounded-lg border border-[rgba(23,23,23,0.1)] bg-[rgba(255,255,255,0.72)] px-3 py-1.5 pr-8 text-sm text-[#171717] outline-none transition placeholder:text-[#a39a90] focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="清空搜索"
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-[#8a8176] transition hover:bg-[rgba(23,23,23,0.06)] hover:text-[#5c544a]"
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
          className="shrink-0 rounded-full bg-[#171717] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[#2b241d]"
        >
          新建待办
        </button>
      </div>

      {saveError ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#e8b4a4] bg-[#fff1ec] px-3 py-2 text-sm text-[#9a3818]">
          <span className="min-w-0 flex-1">{saveError.message}</span>
          {saveError.kind === "draft" ? (
            <button
              type="button"
              onClick={onRetrySave}
              className="shrink-0 rounded-full border border-[#e8b4a4] px-2.5 py-1 text-xs font-medium transition hover:bg-[#ffe3da]"
            >
              重试
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismissError}
            aria-label="忽略错误"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition hover:bg-[#ffe3da]"
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
