import {
  readTodos,
  writeTodo,
  type TodoPriority,
  type TodoStatus,
} from "@/lib/persistence";

export const runtime = "nodejs";

const todoStatuses = new Set<TodoStatus>(["todo", "in_progress", "done"]);
const todoPriorities = new Set<TodoPriority>(["default", "high", "highest"]);

function normalizeStatus(value: unknown): TodoStatus | "all" {
  if (value === "all" || todoStatuses.has(value as TodoStatus)) {
    return value as TodoStatus | "all";
  }

  return "all";
}

function normalizePriority(value: unknown): TodoPriority | undefined {
  if (value === "low" || value === "medium") {
    return "default";
  }

  if (todoPriorities.has(value as TodoPriority)) {
    return value as TodoPriority;
  }

  return undefined;
}

function normalizeLimit(value: string | null) {
  if (!value) {
    return 200;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 200;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const todos = await readTodos({
    query: url.searchParams.get("query") ?? undefined,
    status: normalizeStatus(url.searchParams.get("status")),
    limit: normalizeLimit(url.searchParams.get("limit")),
  });

  return Response.json(todos);
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const result = await writeTodo({
      action: "create",
      title: typeof json.title === "string" ? json.title : undefined,
      content: typeof json.content === "string" ? json.content : undefined,
      priority: normalizePriority(json.priority),
    });

    return Response.json(result, { status: result.success ? 201 : 400 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to create todo.",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const json = await request.json();
    const id = typeof json.id === "string" ? json.id : undefined;
    const action = typeof json.action === "string" ? json.action : "update";

    if (!id) {
      return Response.json({ error: "Todo id is required." }, { status: 400 });
    }

    if (!["update", "complete", "reopen"].includes(action)) {
      return Response.json({ error: "Unsupported todo action." }, { status: 400 });
    }

    const result = await writeTodo({
      action: action as "update" | "complete" | "reopen",
      id,
      title: typeof json.title === "string" ? json.title : undefined,
      content: typeof json.content === "string" ? json.content : undefined,
      status: todoStatuses.has(json.status) ? json.status : undefined,
      priority: normalizePriority(json.priority),
    });

    return Response.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to update todo.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) {
      return Response.json({ error: "Todo id is required." }, { status: 400 });
    }

    const result = await writeTodo({ action: "delete", id });
    return Response.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete todo.",
      },
      { status: 400 },
    );
  }
}
