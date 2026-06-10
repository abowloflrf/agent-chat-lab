"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TodoDrawer } from "@/components/todo-drawer";
import { TodoRow } from "@/components/todo-row";
import { TodoToolbar } from "@/components/todo-toolbar";
import type { TodoRecord } from "@/lib/persistence";
import {
  emptyDraft,
  formatTime,
  nextPriority,
  nextStatus,
  toDraft,
  type SaveErrorInfo,
  type SaveStatus,
  type TodoDraft,
  type TodoFilter,
} from "@/lib/todo-ui";

type LoadState = "loading" | "error" | "ready";

async function requestTodos(): Promise<TodoRecord[]> {
  const response = await fetch("/api/todos?status=all&limit=200");
  const payload = (await response.json()) as { todos?: TodoRecord[]; error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "加载待办失败。");
  }

  return payload.todos ?? [];
}

export function TodoManager() {
  const [todos, setTodos] = useState<TodoRecord[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<TodoFilter>("all");
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit">("create");
  const [draft, setDraft] = useState<TodoDraft>(emptyDraft);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<SaveErrorInfo | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<TodoDraft>(draft);
  const todosRef = useRef<TodoRecord[]>(todos);
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const saveTodoRef = useRef<(() => Promise<void>) | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep draftRef in sync with draft state
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    todosRef.current = todos;
  }, [todos]);

  const visibleTodos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return todos.filter((todo) => {
      const statusMatches = filter === "all" || todo.status === filter;
      const queryMatches =
        !normalizedQuery ||
        todo.title.toLowerCase().includes(normalizedQuery) ||
        todo.content.toLowerCase().includes(normalizedQuery);

      return statusMatches && queryMatches;
    });
  }, [filter, query, todos]);

  const counts = useMemo<Record<TodoFilter, number>>(
    () => ({
      all: todos.length,
      todo: todos.filter((todo) => todo.status === "todo").length,
      in_progress: todos.filter((todo) => todo.status === "in_progress").length,
      done: todos.filter((todo) => todo.status === "done").length,
    }),
    [todos],
  );

  useEffect(() => {
    let cancelled = false;

    requestTodos()
      .then((records) => {
        if (!cancelled) {
          setTodos(records);
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const retryLoad = useCallback(() => {
    setLoadState("loading");
    requestTodos()
      .then((records) => {
        setTodos(records);
        setLoadState("ready");
      })
      .catch(() => {
        setLoadState("error");
      });
  }, []);

  const markSaved = useCallback(() => {
    setSaveStatus("saved");
    setSaveError(null);

    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current);
    }

    savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2500);
  }, []);

  const saveTodo = useCallback(async () => {
    const currentDraft = draftRef.current;

    // Don't create empty todos
    if (currentDraft.id === null && !currentDraft.title.trim()) {
      return;
    }

    // Queue instead of dropping when a save is already running
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      return;
    }

    saveInFlightRef.current = true;
    setSaveStatus("saving");

    try {
      const isEditing = currentDraft.id !== null;
      const response = await fetch("/api/todos", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentDraft.id,
          title: currentDraft.title.trim(),
          content: currentDraft.content,
          status: currentDraft.status,
          priority: currentDraft.priority,
        }),
      });
      const payload = (await response.json()) as { todo?: TodoRecord; error?: string };

      if (!response.ok || !payload.todo) {
        throw new Error(payload.error ?? "保存待办失败。");
      }

      const savedTodo = payload.todo;
      setTodos((current) =>
        isEditing
          ? current.map((todo) => (todo.id === savedTodo.id ? savedTodo : todo))
          : [savedTodo, ...current],
      );

      // New todo created — adopt the id so subsequent saves are PATCH,
      // but only if the draft is still the creation draft
      if (!isEditing && draftRef.current.id === null) {
        setDraft((current) => ({ ...current, id: savedTodo.id }));
        setDrawerMode("edit");
      }

      markSaved();
    } catch {
      setSaveStatus("error");
      setSaveError({ kind: "draft", message: "保存失败，更改未同步" });
    } finally {
      saveInFlightRef.current = false;

      if (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        void saveTodoRef.current?.();
      }
    }
  }, [markSaved]);

  useEffect(() => {
    saveTodoRef.current = saveTodo;
  }, [saveTodo]);

  const debouncedSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void saveTodo();
    }, 2000);
  }, [saveTodo]);

  const flushPendingSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
      void saveTodo();
    }
  }, [saveTodo]);

  const saveImmediate = useCallback(
    async (todoId: string, updates: Partial<Pick<TodoRecord, "status" | "priority">>) => {
      // Snapshot for rollback, then apply the optimistic update
      const previous = todosRef.current.find((todo) => todo.id === todoId) ?? null;

      setTodos((current) =>
        current.map((todo) => (todo.id === todoId ? { ...todo, ...updates } : todo)),
      );

      setSaveStatus("saving");

      try {
        const response = await fetch("/api/todos", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: todoId, ...updates }),
        });
        const payload = (await response.json()) as { todo?: TodoRecord; error?: string };

        if (!response.ok || !payload.todo) {
          throw new Error(payload.error ?? "保存待办失败。");
        }

        const savedTodo = payload.todo;
        setTodos((current) =>
          current.map((todo) => (todo.id === savedTodo.id ? savedTodo : todo)),
        );
        markSaved();
      } catch {
        if (previous) {
          setTodos((current) =>
            current.map((todo) => (todo.id === todoId ? previous : todo)),
          );
        }

        setSaveStatus("error");
        setSaveError({ kind: "action", message: "操作失败，已还原" });
      }
    },
    [markSaved],
  );

  const cancelPendingDelete = useCallback(() => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }

    setPendingDeleteId(null);
  }, []);

  const requestDelete = useCallback((todoId: string) => {
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
    }

    setPendingDeleteId(todoId);
    deleteTimerRef.current = setTimeout(() => {
      deleteTimerRef.current = null;
      setPendingDeleteId(null);
    }, 3000);
  }, []);

  const confirmDelete = useCallback(
    async (todoId: string) => {
      cancelPendingDelete();

      // Deleting the todo open in the drawer: drop pending edits, close it
      if (draftRef.current.id === todoId) {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }

        setDrawerOpen(false);
      }

      const removedIndex = todosRef.current.findIndex((todo) => todo.id === todoId);
      const removed =
        removedIndex === -1
          ? null
          : { todo: todosRef.current[removedIndex], index: removedIndex };

      setTodos((current) => current.filter((todo) => todo.id !== todoId));

      try {
        const response = await fetch(`/api/todos?id=${encodeURIComponent(todoId)}`, {
          method: "DELETE",
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "删除待办失败。");
        }

        setSaveError(null);
      } catch {
        if (removed) {
          setTodos((current) => {
            const next = [...current];
            next.splice(Math.min(removed.index, next.length), 0, removed.todo);
            return next;
          });
        }

        setSaveError({ kind: "delete", message: "删除失败" });
      }
    },
    [cancelPendingDelete],
  );

  // Cancel pending delete on click elsewhere or Escape
  useEffect(() => {
    if (!pendingDeleteId) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement;

      if (!target.closest("[data-todo-delete]")) {
        cancelPendingDelete();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        cancelPendingDelete();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pendingDeleteId, cancelPendingDelete]);

  const openCreate = useCallback(() => {
    flushPendingSave();
    cancelPendingDelete();
    setDraft(emptyDraft);
    setDrawerMode("create");
    setDrawerOpen(true);
  }, [flushPendingSave, cancelPendingDelete]);

  const openTodo = useCallback(
    (todo: TodoRecord) => {
      flushPendingSave();
      cancelPendingDelete();
      setDraft(toDraft(todo));
      setDrawerMode("edit");
      setDrawerOpen(true);
    },
    [flushPendingSave, cancelPendingDelete],
  );

  const closeDrawer = useCallback(() => {
    flushPendingSave();
    setDrawerOpen(false);
  }, [flushPendingSave]);

  const handleCycleStatus = useCallback(
    (todo: TodoRecord) => {
      const value = nextStatus(todo.status);

      if (draftRef.current.id === todo.id) {
        setDraft((current) => ({ ...current, status: value }));
      }

      void saveImmediate(todo.id, { status: value });
    },
    [saveImmediate],
  );

  const handleCyclePriority = useCallback(
    (todo: TodoRecord) => {
      const value = nextPriority(todo.priority);

      if (draftRef.current.id === todo.id) {
        setDraft((current) => ({ ...current, priority: value }));
      }

      void saveImmediate(todo.id, { priority: value });
    },
    [saveImmediate],
  );

  const cycleDraftStatus = useCallback(() => {
    const current = draftRef.current;

    if (!current.id) {
      return;
    }

    const value = nextStatus(current.status);
    setDraft((draftValue) => ({ ...draftValue, status: value }));
    void saveImmediate(current.id, { status: value });
  }, [saveImmediate]);

  const cycleDraftPriority = useCallback(() => {
    const current = draftRef.current;
    const value = nextPriority(current.priority);
    setDraft((draftValue) => ({ ...draftValue, priority: value }));

    if (current.id) {
      void saveImmediate(current.id, { priority: value });
    }
  }, [saveImmediate]);

  const handleTitleChange = useCallback(
    (title: string) => {
      setDraft((current) => ({ ...current, title }));
      debouncedSave();
    },
    [debouncedSave],
  );

  const handleContentChange = useCallback(
    (content: string) => {
      setDraft((current) => ({ ...current, content }));
      debouncedSave();
    },
    [debouncedSave],
  );

  const retrySave = useCallback(() => {
    void saveTodo();
  }, [saveTodo]);

  const dismissError = useCallback(() => {
    setSaveError(null);
  }, []);

  // Ctrl+S / Cmd+S saves the open drawer immediately
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();

        if (!drawerOpen) {
          return;
        }

        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }

        void saveTodo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [drawerOpen, saveTodo]);

  const activeTodo = draft.id ? todos.find((todo) => todo.id === draft.id) ?? null : null;
  const updatedAtLabel = activeTodo ? `更新于 ${formatTime(activeTodo.updatedAt)}` : "新建待办";

  return (
    <main className="app-shell h-full overflow-hidden text-[#171717]">
      <section className="glass-panel rise-in flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[rgba(23,23,23,0.08)] px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Link
            href="/"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(23,23,23,0.1)] text-[#5c544a] transition hover:bg-[rgba(23,23,23,0.04)]"
            aria-label="返回聊天"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <h1 className="text-lg font-semibold tracking-[-0.02em] text-[#241c15]">
            待办清单
          </h1>
        </div>

        <div className="border-b border-[rgba(23,23,23,0.08)] px-4 py-3">
          <div className="mx-auto w-full max-w-3xl">
            <TodoToolbar
              filter={filter}
              counts={counts}
              query={query}
              saveError={saveError}
              onFilterChange={setFilter}
              onQueryChange={setQuery}
              onCreate={openCreate}
              onRetrySave={retrySave}
              onDismissError={dismissError}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="mx-auto w-full max-w-3xl">
            {loadState === "loading" ? (
              <div className="py-12 text-center text-sm text-[#8a8176]">
                加载待办中...
              </div>
            ) : loadState === "error" ? (
              <div className="accent-line py-12 pl-4">
                <p className="text-lg font-semibold tracking-[-0.02em] text-[#352d25]">
                  加载待办失败
                </p>
                <p className="mt-2 text-sm leading-6 text-[#6e665d]">
                  请检查网络后重试。
                </p>
                <button
                  type="button"
                  onClick={retryLoad}
                  className="mt-4 rounded-full bg-[#171717] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2b241d]"
                >
                  重试
                </button>
              </div>
            ) : visibleTodos.length === 0 ? (
              <div className="accent-line py-12 pl-4">
                <p className="text-lg font-semibold tracking-[-0.02em] text-[#352d25]">
                  没有匹配的待办
                </p>
                <p className="mt-2 text-sm leading-6 text-[#6e665d]">
                  调整筛选条件，或新建一条待办。
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {visibleTodos.map((todo, index) => (
                  <TodoRow
                    key={todo.id}
                    todo={todo}
                    isActive={drawerOpen && draft.id === todo.id}
                    isPendingDelete={pendingDeleteId === todo.id}
                    animationDelay={Math.min(index * 28, 180)}
                    onOpen={() => openTodo(todo)}
                    onCycleStatus={() => handleCycleStatus(todo)}
                    onCyclePriority={() => handleCyclePriority(todo)}
                    onRequestDelete={() => requestDelete(todo.id)}
                    onConfirmDelete={() => void confirmDelete(todo.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <TodoDrawer
        open={drawerOpen}
        mode={drawerMode}
        draft={draft}
        saveStatus={saveStatus}
        updatedAtLabel={drawerMode === "create" && !draft.id ? "新建待办" : updatedAtLabel}
        isPendingDelete={draft.id !== null && pendingDeleteId === draft.id}
        onTitleChange={handleTitleChange}
        onContentChange={handleContentChange}
        onCycleStatus={cycleDraftStatus}
        onCyclePriority={cycleDraftPriority}
        onClose={closeDrawer}
        onRequestDelete={() => {
          if (draft.id) {
            requestDelete(draft.id);
          }
        }}
        onConfirmDelete={() => {
          if (draft.id) {
            void confirmDelete(draft.id);
          }
        }}
      />
    </main>
  );
}
