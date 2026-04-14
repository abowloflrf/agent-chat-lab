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
  high: "高",
  medium: "中",
  low: "低",
};

const statusDotStyles: Record<TodoStatus, string> = {
  todo: "border-[#cdbba8] bg-transparent",
  in_progress: "border-[#d98a52] bg-[#d98a52]/20",
  done: "border-[#6d8c55] bg-[#6d8c55]",
};

const priorityTextStyles: Record<TodoPriority, string> = {
  high: "text-[#9a3f18]",
  medium: "text-[#76501b]",
  low: "text-[#536344]",
};

const emptyDraft: TodoDraft = {
  id: null,
  title: "",
  content: "",
  status: "todo",
  priority: "medium",
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

export function TodoManager() {
  const [todos, setTodos] = useState<TodoRecord[]>([]);
  const [activeFilter, setActiveFilter] = useState<TodoFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TodoDraft>(emptyDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const selectedTodo = todos.find((todo) => todo.id === selectedId) ?? null;

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
    setSelectedId(null);
    setDraft(emptyDraft);
    setMessage(null);
  }

  function selectTodo(todo: TodoRecord) {
    setSelectedId(todo.id);
    setDraft(toDraft(todo));
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

  async function updateStatus(todo: TodoRecord, status: TodoStatus) {
    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/todos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: todo.id,
          action: "update",
          status,
        }),
      });
      const payload = (await response.json()) as { todo?: TodoRecord; error?: string };

      if (!response.ok || !payload.todo) {
        throw new Error(payload.error ?? "更新状态失败。");
      }

      const savedTodo = payload.todo;
      setTodos((current) =>
        current.map((item) => (item.id === savedTodo.id ? savedTodo : item)),
      );

      if (selectedId === savedTodo.id) {
        setDraft(toDraft(savedTodo));
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "更新状态时发生未知错误。",
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
            <Link
              href="/settings"
              className="ml-auto rounded-full bg-[rgba(23,23,23,0.06)] px-3 py-1.5 text-xs font-medium text-[#5c544a]"
            >
              设置
            </Link>
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

              {message ? (
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

                    return (
                      <button
                        key={todo.id}
                        type="button"
                        onClick={() => selectTodo(todo)}
                        className={`rise-in group w-full rounded-lg border px-3 py-2 text-left transition ${
                          selected
                            ? "border-[rgba(201,106,43,0.38)] bg-white"
                            : "border-transparent bg-transparent hover:border-[rgba(23,23,23,0.08)] hover:bg-white/70"
                        }`}
                        style={{ animationDelay: `${Math.min(index * 28, 180)}ms` }}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`h-3.5 w-3.5 shrink-0 rounded-full border ${statusDotStyles[todo.status]}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[15px] font-medium tracking-[-0.02em] text-[#282019]">
                              {todo.title}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-[#8a8176]">
                              {statusLabels[todo.status]} · 更新 {formatTime(todo.updatedAt)}
                              {todo.completedAt ? ` · 完成 ${formatTime(todo.completedAt)}` : ""}
                            </p>
                          </div>
                          <span className={`shrink-0 text-xs font-medium ${priorityTextStyles[todo.priority]}`}>
                            {priorityLabels[todo.priority]}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <aside className="min-h-0 overflow-y-auto bg-[rgba(255,250,244,0.7)] px-4 py-4 lg:px-6">
              <form onSubmit={handleSubmit} className="flex min-h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                    {selectedTodo ? "编辑 TODO" : "新增 TODO"}
                  </p>
                  </div>
                  {draft.id ? (
                    <button
                      type="button"
                      onClick={() => void deleteTodo()}
                      disabled={isSaving}
                      className="rounded-full border border-[#e0b3a2] px-3 py-1.5 text-xs font-medium text-[#9a3818] transition hover:bg-[#fff1ec] disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      删除
                    </button>
                  ) : null}
                </div>

                <label className="block">
                  <span className="mb-2 block text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                    标题
                  </span>
                  <input
                    value={draft.title}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, title: event.target.value }))
                    }
                    placeholder="例如：整理下周发布清单"
                    className="w-full rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-4 py-3 text-xl font-semibold tracking-[-0.03em] text-[#171717] outline-none transition placeholder:text-[#a39a90] focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-2 block text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                      状态
                    </span>
                    <select
                      value={draft.status}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          status: event.target.value as TodoStatus,
                        }))
                      }
                      className="w-full rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-3 py-2.5 text-sm text-[#171717] outline-none transition focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                    >
                      <option value="todo">待处理</option>
                      <option value="in_progress">进行中</option>
                      <option value="done">已完成</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                      优先级
                    </span>
                    <select
                      value={draft.priority}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          priority: event.target.value as TodoPriority,
                        }))
                      }
                      className="w-full rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-3 py-2.5 text-sm text-[#171717] outline-none transition focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                    >
                      <option value="high">高</option>
                      <option value="medium">中</option>
                      <option value="low">低</option>
                    </select>
                  </label>
                </div>

                {selectedTodo ? (
                  <div className="grid grid-cols-3 gap-2">
                    {(["todo", "in_progress", "done"] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        disabled={isSaving || selectedTodo.status === status}
                        onClick={() => void updateStatus(selectedTodo, status)}
                        className="rounded-lg border border-[rgba(23,23,23,0.1)] px-2 py-2 text-xs font-medium text-[#5c544a] transition hover:border-[rgba(201,106,43,0.45)] hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {statusLabels[status]}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="flex min-h-[420px] flex-1 flex-col">
                  <span className="mb-2 block text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                    详情 Markdown
                  </span>
                  <MarkdownEditor
                    value={draft.content}
                    onChange={(content) =>
                      setDraft((current) => ({ ...current, content }))
                    }
                    placeholder="补充上下文、验收标准或下一步动作..."
                  />
                </div>

                <div className="sticky bottom-0 -mx-4 mt-auto flex items-center gap-2 border-t border-[rgba(23,23,23,0.08)] bg-[rgba(255,250,244,0.92)] px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 rounded-full bg-[#171717] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#2b241d] disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {isSaving ? "保存中..." : "保存 TODO"}
                  </button>
                  <button
                    type="button"
                    onClick={startCreate}
                    disabled={isSaving}
                    className="rounded-full border border-[rgba(23,23,23,0.12)] px-4 py-2.5 text-sm font-medium text-[#5c544a] transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    清空
                  </button>
                </div>
              </form>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
