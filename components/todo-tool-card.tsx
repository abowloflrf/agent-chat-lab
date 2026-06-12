"use client";

import type { TodoPriority, TodoStatus } from "@/lib/persistence";
import {
  priorityLabels,
  priorityMark,
  priorityMarkStyles,
  statusDotStyles,
  statusLabels,
  statusPillStyles,
} from "@/lib/todo-ui";

const TODO_TOOL_NAMES = ["TodoWrite", "TodoRead"] as const;

type TodoToolName = (typeof TODO_TOOL_NAMES)[number];

export function isTodoToolName(name: string): name is TodoToolName {
  return (TODO_TOOL_NAMES as readonly string[]).includes(name);
}

const todoWriteVerbs: Record<string, string> = {
  create: "新建",
  update: "更新",
  complete: "完成",
  reopen: "重开",
  delete: "删除",
};

const todoWriteResultLabels: Record<string, string> = {
  create: "已创建",
  update: "已更新",
  complete: "已完成",
  reopen: "已重开",
  delete: "已删除",
};

const statusValues: readonly string[] = ["todo", "in_progress", "done"];
const priorityValues: readonly string[] = ["default", "high", "highest"];

type ParsedTodo = {
  id: string;
  title: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
  completedAt: string | null;
};

function parseTodoRecord(value: unknown): ParsedTodo | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || typeof record.title !== "string") {
    return null;
  }

  if (typeof record.status !== "string" || !statusValues.includes(record.status)) {
    return null;
  }

  if (typeof record.priority !== "string" || !priorityValues.includes(record.priority)) {
    return null;
  }

  return {
    id: record.id,
    title: record.title,
    content: typeof record.content === "string" ? record.content : "",
    status: record.status as TodoStatus,
    priority: record.priority as TodoPriority,
    completedAt: typeof record.completedAt === "string" ? record.completedAt : null,
  };
}

type TodoWriteOutput =
  | { success: true; action: string; todo: ParsedTodo }
  | { success: false; action: string; error: string };

function parseTodoWriteOutput(output: unknown): TodoWriteOutput | null {
  if (!output || typeof output !== "object") {
    return null;
  }

  const record = output as Record<string, unknown>;

  if (typeof record.success !== "boolean" || typeof record.action !== "string") {
    return null;
  }

  if (!record.success) {
    return {
      success: false,
      action: record.action,
      error: typeof record.error === "string" ? record.error : "操作失败。",
    };
  }

  const todo = parseTodoRecord(record.todo);

  if (!todo) {
    return null;
  }

  return { success: true, action: record.action, todo };
}

type TodoReadOutput = {
  totalMatches: number;
  query: string | null;
  status: string | null;
  todos: ParsedTodo[];
};

function parseTodoReadOutput(output: unknown): TodoReadOutput | null {
  if (!output || typeof output !== "object") {
    return null;
  }

  const record = output as Record<string, unknown>;

  if (typeof record.totalMatches !== "number" || !Array.isArray(record.todos)) {
    return null;
  }

  return {
    totalMatches: record.totalMatches,
    query: typeof record.query === "string" && record.query ? record.query : null,
    status: typeof record.status === "string" ? record.status : null,
    todos: record.todos
      .map(parseTodoRecord)
      .filter((todo): todo is ParsedTodo => todo !== null),
  };
}

function readFilterLabel(status: string | null) {
  if (!status || status === "all") {
    return null;
  }

  return (statusLabels as Record<string, string>)[status] ?? status;
}

export function summarizeTodoInput(
  toolName: TodoToolName,
  input: Record<string, unknown>,
): string | null {
  if (toolName === "TodoWrite") {
    const action = typeof input.action === "string" ? input.action : null;

    if (!action) {
      return null;
    }

    const verb = todoWriteVerbs[action] ?? action;

    if (typeof input.title === "string" && input.title.trim()) {
      return `${verb} · ${input.title.trim()}`;
    }

    if (typeof input.id === "string" && input.id) {
      return `${verb} · #${input.id.slice(0, 8)}`;
    }

    return verb;
  }

  if (typeof input.query === "string" && input.query.trim()) {
    return `查询 · ${input.query.trim()}`;
  }

  const filterLabel = readFilterLabel(
    typeof input.status === "string" ? input.status : null,
  );

  return filterLabel ?? "全部";
}

function TodoLine({ todo, deleted }: { todo: ParsedTodo; deleted?: boolean }) {
  const mark = priorityMark(todo.priority);
  const titleClass =
    deleted || todo.status === "done"
      ? "text-[#8e8070] line-through"
      : "text-[#282019]";

  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${statusDotStyles[todo.status]}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[13px] font-medium tracking-[-0.01em] ${titleClass}`}>
            {todo.title}
          </span>
          {mark ? (
            <span
              className={`text-[12px] font-bold tracking-[0.12em] ${priorityMarkStyles[todo.priority]}`}
              title={`优先级${priorityLabels[todo.priority]}`}
            >
              {mark}
            </span>
          ) : null}
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusPillStyles[todo.status]}`}
          >
            {statusLabels[todo.status]}
          </span>
        </div>
        {todo.content ? (
          <p className="mt-1 truncate text-[12px] leading-5 text-[#8e8070]">
            {todo.content}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function TodoToolPanel({
  toolName,
  output,
}: {
  toolName: TodoToolName;
  output: unknown;
}) {
  if (toolName === "TodoWrite") {
    const parsed = parseTodoWriteOutput(output);

    if (!parsed) {
      return null;
    }

    if (!parsed.success) {
      return (
        <div className="rounded-[12px] border border-[rgba(153,27,27,0.15)] bg-[#fee2e2] px-3.5 py-2.5 text-[12px] leading-5 text-[#991b1b]">
          {todoWriteVerbs[parsed.action] ?? parsed.action}失败：{parsed.error}
        </div>
      );
    }

    return (
      <div className="rounded-[12px] border border-[rgba(23,23,23,0.08)] bg-white/80 p-3.5">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
          {todoWriteResultLabels[parsed.action] ?? parsed.action}
        </p>
        <div className="mt-2">
          <TodoLine todo={parsed.todo} deleted={parsed.action === "delete"} />
        </div>
      </div>
    );
  }

  const parsed = parseTodoReadOutput(output);

  if (!parsed) {
    return null;
  }

  const filterLabel = readFilterLabel(parsed.status);

  return (
    <div className="rounded-[12px] border border-[rgba(23,23,23,0.08)] bg-white/80 p-3.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
        共 {parsed.totalMatches} 项
        {parsed.query ? ` · 关键词 "${parsed.query}"` : ""}
        {filterLabel ? ` · ${filterLabel}` : ""}
      </p>
      {parsed.todos.length === 0 ? (
        <p className="mt-2 text-[12px] text-[#8e8070]">没有匹配的待办</p>
      ) : (
        <div className="mt-2.5 space-y-2.5">
          {parsed.todos.map((todo) => (
            <TodoLine key={todo.id} todo={todo} />
          ))}
        </div>
      )}
    </div>
  );
}
