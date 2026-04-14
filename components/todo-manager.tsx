"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { ModuleSwitcher } from "@/components/module-switcher";
import type { TodoPriority, TodoRecord, TodoStatus } from "@/lib/persistence";

type TodoFilter = TodoStatus | "all";

type TodoDraft = {
  id: string | null;
  title: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
};

const statusLabels: Record<TodoFilter, string> = {
  all: "全部",
  todo: "待处理",
  in_progress: "进行中",
  done: "已完成",
};

const priorityLabels: Record<TodoPriority, string> = {
  default: "默认",
  high: "高",
  highest: "最高",
};

const statusDotStyles: Record<TodoStatus, string> = {
  todo: "border-[#cdbba8] bg-transparent",
  in_progress: "border-[#d98a52] bg-[#d98a52]/20",
  done: "border-[#6d8c55] bg-[#6d8c55]",
};

const statusOptions: Array<{ value: TodoStatus; label: string }> = [
  { value: "todo", label: "待处理" },
  { value: "in_progress", label: "进行中" },
  { value: "done", label: "已完成" },
];

const priorityOptions: Array<{ value: TodoPriority; label: string }> = [
  { value: "default", label: "默认" },
  { value: "high", label: "高" },
  { value: "highest", label: "最高" },
];

const statusPillStyles: Record<TodoStatus, string> = {
  todo: "border-[#d6cab8] bg-[#f8f1e7] text-[#5d5143]",
  in_progress: "border-[#e2b288] bg-[#fff1e3] text-[#9a5b22]",
  done: "border-[#bfd0b0] bg-[#edf5e8] text-[#4f6c3c]",
};

const priorityPillStyles: Record<TodoPriority, string> = {
  default: "border-[#d6cec4] bg-[#f6f1ea] text-[#6c5e51]",
  high: "border-[#e4c093] bg-[#fff4e7] text-[#96581f]",
  highest: "border-[#e5b2a6] bg-[#fff0ec] text-[#9a3818]",
};

const emptyDraft: TodoDraft = {
  id: null,
  title: "",
  content: "",
  status: "todo",
  priority: "default",
};

function formatTime(value: string | null) {
  if (!value) {
    return "未完成";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDraft(todo: TodoRecord): TodoDraft {
  return {
    id: todo.id,
    title: todo.title,
    content: todo.content,
    status: todo.status,
    priority: todo.priority,
  };
}

function countByStatus(todos: TodoRecord[], status: TodoStatus) {
  return todos.filter((todo) => todo.status === status).length;
}

function priorityMark(priority: TodoPriority) {
  if (priority === "highest") {
    return "!!";
  }

  if (priority === "high") {
    return "!";
  }

  return "";
}

export function TodoManager() {
  const [todos, setTodos] = useState<TodoRecord[]>([]);
  const [activeFilter, setActiveFilter] = useState<TodoFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<TodoDraft>(emptyDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const selectedTodo = todos.find((todo) => todo.id === selectedId) ?? null;
  const isEditorOpen = isCreating || Boolean(selectedTodo);

  const visibleTodos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return todos.filter((todo) => {
      const statusMatches = activeFilter === "all" || todo.status === activeFilter;
      const queryMatches =
        !normalizedQuery ||
        todo.title.toLowerCase().includes(normalizedQuery) ||
        todo.content.toLowerCase().includes(normalizedQuery) ||
        todo.priority.includes(normalizedQuery) ||
        todo.status.includes(normalizedQuery);

      return statusMatches && queryMatches;
    });
  }, [activeFilter, query, todos]);

  const stats = [
    { label: "全部", value: todos.length, filter: "all" as const },
    { label: "待处理", value: countByStatus(todos, "todo"), filter: "todo" as const },
    { label: "进行中", value: countByStatus(todos, "in_progress"), filter: "in_progress" as const },
    { label: "已完成", value: countByStatus(todos, "done"), filter: "done" as const },
  ];

  useEffect(() => {
    let cancelled = false;

    async function loadTodos() {
      setIsLoading(true);

      try {
        const response = await fetch("/api/todos?status=all&limit=200");
        const payload = (await response.json()) as { todos?: TodoRecord[]; error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "加载待办失败。");
        }

        if (!cancelled) {
          setTodos(payload.todos ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage({
            type: "error",
            text: error instanceof Error ? error.message : "加载待办时发生未知错误。",
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadTodos();

    return () => {
      cancelled = true;
    };
  }, []);

  function startCreate() {
    setIsCreating(true);
    setSelectedId(null);
    setDraft(emptyDraft);
    setMessage(null);
  }

  function selectTodo(todo: TodoRecord) {
    setIsCreating(false);
    setSelectedId(todo.id);
    setDraft(toDraft(todo));
    setMessage(null);
  }

  function closeEditor() {
    setIsCreating(false);
    setSelectedId(null);
    setDraft(emptyDraft);
    setMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = draft.title.trim();
    if (!title) {
      setMessage({ type: "error", text: "请先填写待办标题。" });
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const isEditing = Boolean(draft.id);
      const response = await fetch("/api/todos", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          title,
          content: draft.content,
          status: draft.status,
          priority: draft.priority,
        }),
      });
      const payload = (await response.json()) as { todo?: TodoRecord; error?: string };

      if (!response.ok || !payload.todo) {
        throw new Error(payload.error ?? "保存待办失败。");
      }

      const savedTodo = payload.todo;
      setTodos((current) => {
        if (isEditing) {
          return current.map((todo) => (todo.id === savedTodo.id ? savedTodo : todo));
        }

        return [savedTodo, ...current];
      });
      setSelectedId(savedTodo.id);
      setIsCreating(false);
      setDraft(toDraft(savedTodo));
      setMessage({ type: "success", text: isEditing ? "待办已更新。" : "待办已创建。" });
      setTimeout(() => setMessage(null), 2400);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "保存待办时发生未知错误。",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteTodo() {
    if (!draft.id) {
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/todos?id=${encodeURIComponent(draft.id)}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "删除待办失败。");
      }

      setTodos((current) => current.filter((todo) => todo.id !== draft.id));
      setIsCreating(false);
      setSelectedId(null);
      setDraft(emptyDraft);
      setMessage({ type: "success", text: "待办已删除。" });
      setTimeout(() => setMessage(null), 2400);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "删除待办时发生未知错误。",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="app-shell h-full overflow-hidden text-[#171717]">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="dark-panel rise-in relative hidden h-full overflow-hidden border-r border-white/10 p-4 pt-[max(1rem,env(safe-area-inset-top))] lg:block">
          <div className="relative flex h-full flex-col">
            <div className="border-b border-white/8 pb-4">
              <ModuleSwitcher />
            </div>

            <div className="pt-4">
              <div className="space-y-1 border-b border-white/8 pb-4">
                {stats.map((item) => (
                  <button
                    key={item.filter}
                    type="button"
                    onClick={() => setActiveFilter(item.filter)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition ${
                      activeFilter === item.filter
                        ? "border-white/16 bg-white/10 text-[#fff7ef]"
                        : "border-transparent text-[#cabfb2] hover:border-white/10 hover:bg-white/6 hover:text-[#fff7ef]"
                    }`}
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="font-mono text-xs text-[#d8c9b7]">
                      {item.value}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <section className="glass-panel rise-in flex h-full min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-[rgba(23,23,23,0.08)] px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
            <Link
              href="/"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(23,23,23,0.1)] text-[#5c544a] transition hover:bg-[rgba(23,23,23,0.04)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </Link>
            <p className="text-lg font-semibold tracking-[-0.02em] text-[#241c15]">
              TODO
            </p>
          </div>

          <header className="hidden border-b border-[rgba(23,23,23,0.08)] px-4 py-3 lg:block">
            <div className="flex items-center justify-between gap-6">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-[#8a8176]">
                  Todo Manager
                </p>
                <h1 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#241c15]">
                  待办清单
                </h1>
              </div>
              <button
                type="button"
                onClick={startCreate}
                className="rounded-full bg-[#171717] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2b241d]"
              >
                新增 TODO
              </button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
            <div className="min-h-0 overflow-y-auto border-r border-[rgba(23,23,23,0.08)] px-3 py-3">
              <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">搜索待办</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索 TODO..."
                    className="w-full rounded-lg border border-[rgba(23,23,23,0.1)] bg-[rgba(255,255,255,0.72)] px-3 py-2 text-sm text-[#171717] outline-none transition placeholder:text-[#a39a90] focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                  />
                </label>
                <button
                  type="button"
                  onClick={startCreate}
                  className="rounded-lg border border-[rgba(23,23,23,0.1)] px-3 py-2 text-sm font-medium text-[#352d25] transition hover:border-[rgba(201,106,43,0.45)] hover:bg-white/55 lg:hidden"
                >
                  新增 TODO
                </button>
              </div>

              <div className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
                {stats.map((item) => (
                  <button
                    key={item.filter}
                    type="button"
                    onClick={() => setActiveFilter(item.filter)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      activeFilter === item.filter
                        ? "bg-[#171717] text-white"
                        : "bg-[rgba(23,23,23,0.06)] text-[#5c544a]"
                    }`}
                  >
                    {item.label} {item.value}
                  </button>
                ))}
              </div>

              {message && !isEditorOpen ? (
                <div
                  className={`mb-3 rounded-[14px] border px-3 py-2 text-sm ${
                    message.type === "success"
                      ? "border-[#d8c7a7] bg-[#fff9ec] text-[#76501b]"
                      : "border-[#e8b5a7] bg-[#fff1ec] text-[#9a3818]"
                  }`}
                >
                  {message.text}
                </div>
              ) : null}

              {isLoading ? (
                <div className="py-12 text-center text-sm text-[#8a8176]">
                  加载 TODO 中...
                </div>
              ) : visibleTodos.length === 0 ? (
                <div className="accent-line py-12 pl-4">
                  <p className="text-lg font-semibold tracking-[-0.02em] text-[#352d25]">
                    没有匹配的待办
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#6e665d]">
                    调整筛选条件，或创建一个新的 TODO。
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {visibleTodos.map((todo, index) => {
                    const selected = todo.id === selectedId;
                    const mark = priorityMark(todo.priority);

                    return (
                      <button
                        key={todo.id}
                        type="button"
                        onClick={() => selectTodo(todo)}
                        className={`rise-in group w-full rounded-[22px] border px-4 py-3 text-left transition ${
                          selected
                            ? "border-[rgba(201,106,43,0.32)] bg-white"
                            : "border-transparent bg-transparent hover:border-[rgba(23,23,23,0.08)] hover:bg-white/72"
                        }`}
                        style={{ animationDelay: `${Math.min(index * 28, 180)}ms` }}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`mt-1.5 h-3 w-3 shrink-0 rounded-full border ${statusDotStyles[todo.status]}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-medium tracking-[-0.025em] text-[#282019]">
                              {todo.title}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                                  statusPillStyles[todo.status]
                                }`}
                              >
                                {statusLabels[todo.status]}
                              </span>
                              {mark ? (
                                <span
                                  className={`text-[13px] font-bold tracking-[0.12em] ${
                                    todo.priority === "highest" ? "text-[#9a3818]" : "text-[#9a5b22]"
                                  }`}
                                  aria-label={`优先级${priorityLabels[todo.priority]}`}
                                  title={`优先级${priorityLabels[todo.priority]}`}
                                >
                                  {mark}
                                </span>
                              ) : null}
                              <span className="text-[11px] text-[#908679]">
                                更新 {formatTime(todo.updatedAt)}
                              </span>
                              {todo.completedAt ? (
                                <span className="text-[11px] text-[#908679]">
                                  完成 {formatTime(todo.completedAt)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <aside
              className={`min-h-0 overflow-y-auto bg-[rgba(255,250,244,0.7)] px-4 py-4 lg:px-6 ${
                isEditorOpen ? "block" : "hidden lg:block"
              }`}
            >
              {isEditorOpen ? (
                <form onSubmit={handleSubmit} className="flex min-h-full flex-col">
                  <div className="flex flex-1 flex-col pt-2">
                    <input
                      value={draft.title}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, title: event.target.value }))
                      }
                      placeholder="例如：整理下周发布清单"
                      className="w-full border-none bg-transparent px-0 py-0 text-[clamp(1.65rem,3vw,2.35rem)] font-bold leading-[1.08] tracking-[-0.035em] text-[#171717] outline-none placeholder:text-[#b0a395]"
                    />

                    <div className="mt-6 h-px bg-[rgba(23,23,23,0.08)]" />

                    <div className="min-h-[420px] flex-1 pt-6">
                      <MarkdownEditor
                        value={draft.content}
                        onChange={(content) =>
                          setDraft((current) => ({ ...current, content }))
                        }
                        placeholder="补充上下文、验收标准或下一步动作..."
                        variant="minimal"
                      />
                    </div>
                  </div>

                  <div className="sticky bottom-0 -mx-4 mt-auto border-t border-[rgba(23,23,23,0.08)] bg-[rgba(255,250,244,0.94)] px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-xs text-[#6e665d]">
                          {selectedTodo ? `更新于 ${formatTime(selectedTodo.updatedAt)}` : "新建待办"}
                          {selectedTodo?.completedAt ? ` · 完成于 ${formatTime(selectedTodo.completedAt)}` : ""}
                        </p>
                        {draft.id ? (
                          <button
                            type="button"
                            onClick={() => void deleteTodo()}
                            disabled={isSaving}
                            className="shrink-0 rounded-full border border-[#e0b3a2] px-3 py-1.5 text-xs font-medium text-[#9a3818] transition hover:bg-[#fff1ec] disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            删除
                          </button>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                              状态
                            </span>
                            {statusOptions.map((option) => {
                              const active = draft.status === option.value;

                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() =>
                                    setDraft((current) => ({ ...current, status: option.value }))
                                  }
                                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                                    active
                                      ? statusPillStyles[option.value]
                                      : "border-[rgba(23,23,23,0.1)] bg-white/55 text-[#5c544a] hover:bg-white"
                                  }`}
                                >
                                  <span
                                    className={`h-2 w-2 rounded-full ${
                                      option.value === "todo"
                                        ? "bg-[#b8a58d]"
                                        : option.value === "in_progress"
                                          ? "bg-[#d98a52]"
                                          : "bg-[#6d8c55]"
                                    }`}
                                  />
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                              优先级
                            </span>
                            {priorityOptions.map((option) => {
                              const active = draft.priority === option.value;

                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() =>
                                    setDraft((current) => ({ ...current, priority: option.value }))
                                  }
                                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                                    active
                                      ? priorityPillStyles[option.value]
                                      : "border-[rgba(23,23,23,0.1)] bg-white/55 text-[#5c544a] hover:bg-white"
                                  }`}
                                >
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={closeEditor}
                            disabled={isSaving}
                            className="rounded-full border border-[rgba(23,23,23,0.12)] px-4 py-2.5 text-sm font-medium text-[#5c544a] transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {selectedTodo ? "收起" : "取消"}
                          </button>
                          <button
                            type="submit"
                            disabled={isSaving}
                            className="rounded-full bg-[#171717] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#2b241d] disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {isSaving ? "保存中..." : "保存 TODO"}
                          </button>
                        </div>
                      </div>

                      {message ? (
                        <div
                          className={`rounded-[14px] border px-3 py-2 text-sm ${
                            message.type === "success"
                              ? "border-[#d8c7a7] bg-[#fff9ec] text-[#76501b]"
                              : "border-[#e8b5a7] bg-[#fff1ec] text-[#9a3818]"
                          }`}
                        >
                          {message.text}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </form>
              ) : (
                <div className="flex h-full min-h-[540px] items-center justify-center px-8">
                  <div className="max-w-sm text-center">
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] border border-[rgba(23,23,23,0.08)] bg-white/72 shadow-[0_18px_50px_-36px_rgba(23,23,23,0.5)]">
                      <svg
                        width="34"
                        height="34"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-[#6b5f51]"
                      >
                        <path d="M9 11.5 11.5 14 15.5 9.5" />
                        <path d="M8 5.5h8" />
                        <path d="M8 18.5h5" />
                        <rect x="4.5" y="3.5" width="15" height="17" rx="3.5" />
                      </svg>
                    </div>
                    <p className="mt-6 text-[1.75rem] font-semibold tracking-[-0.05em] text-[#241c15]">
                      先选一条待办
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[#6e665d]">
                      右侧只在需要编辑时展开。你可以从左侧选择一项继续处理，或者直接新建一条 TODO。
                    </p>
                    <button
                      type="button"
                      onClick={startCreate}
                      className="mt-6 rounded-full bg-[#171717] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#2b241d]"
                    >
                      新建 TODO
                    </button>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
