import type { TodoPriority, TodoRecord, TodoStatus } from "@/lib/persistence";

export type TodoFilter = TodoStatus | "all";

export type TodoDraft = {
  id: string | null;
  title: string;
  content: string;
  status: TodoStatus;
  priority: TodoPriority;
};

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export type SaveErrorInfo = {
  kind: "draft" | "action" | "delete";
  message: string;
};

export const statusLabels: Record<TodoFilter, string> = {
  all: "全部",
  todo: "待处理",
  in_progress: "进行中",
  done: "已完成",
};

export const priorityLabels: Record<TodoPriority, string> = {
  default: "默认",
  high: "高",
  highest: "最高",
};

export const statusDotStyles: Record<TodoStatus, string> = {
  todo: "border-[#cdbba8] bg-transparent",
  in_progress: "border-[#d98a52] bg-[#d98a52]/20",
  done: "border-[#6d8c55] bg-[#6d8c55]",
};

export const statusPillStyles: Record<TodoStatus, string> = {
  todo: "border-[#d6cab8] bg-[#f8f1e7] text-[#5d5143]",
  in_progress: "border-[#e2b288] bg-[#fff1e3] text-[#9a5b22]",
  done: "border-[#bfd0b0] bg-[#edf5e8] text-[#4f6c3c]",
};

export const priorityMarkStyles: Record<TodoPriority, string> = {
  default: "text-[#b0a395]",
  high: "text-[#9a5b22]",
  highest: "text-[#9a3818]",
};

export const emptyDraft: TodoDraft = {
  id: null,
  title: "",
  content: "",
  status: "todo",
  priority: "default",
};

export function priorityMark(priority: TodoPriority) {
  if (priority === "highest") {
    return "!!";
  }

  if (priority === "high") {
    return "!";
  }

  return "";
}

export function toDraft(todo: TodoRecord): TodoDraft {
  return {
    id: todo.id,
    title: todo.title,
    content: todo.content,
    status: todo.status,
    priority: todo.priority,
  };
}

export function formatTime(value: string | null) {
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

export function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return "";
  }

  const elapsedMs = Date.now() - timestamp;
  const minutes = Math.floor(elapsedMs / 60_000);

  if (minutes < 1) {
    return "刚刚";
  }

  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} 小时前`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days} 天前`;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

const statusCycle: TodoStatus[] = ["todo", "in_progress", "done"];
const priorityCycle: TodoPriority[] = ["default", "high", "highest"];

export function nextStatus(status: TodoStatus): TodoStatus {
  return statusCycle[(statusCycle.indexOf(status) + 1) % statusCycle.length];
}

export function nextPriority(priority: TodoPriority): TodoPriority {
  return priorityCycle[(priorityCycle.indexOf(priority) + 1) % priorityCycle.length];
}
