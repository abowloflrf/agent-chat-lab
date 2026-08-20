# Resumable Streaming 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户关闭浏览器页面后，Agent 继续在服务端运行；重新打开页面时自动重连流，从断点继续接收消息（包括工具调用结果）。

**Architecture:** 将 Agent 执行从 HTTP 请求生命周期中解耦。引入 AgentRunner 模块管理后台运行的 Agent 任务，使用 EventEmitter 做进程内实时通知，SQLite `run_events` 表做持久化事件日志用于断线重连回放。客户端利用 AI SDK 内置的 `useChat({ resume: true })` + `prepareReconnectToStreamRequest` 实现自动重连。

**Tech Stack:** Next.js 16, AI SDK v6 (`streamText`, `useChat`, `DefaultChatTransport`), SQLite (better-sqlite3), Drizzle ORM, EventEmitter

---

## Context

当前架构中 `streamText()` 的结果通过 `toUIMessageStreamResponse()` 直接绑定在 HTTP 响应上。用户关闭页面 = HTTP 连接断开 = 流丢失。服务端可能继续运行但客户端无法接收结果；`persistFinishedConversation()` 在 `onFinish` 中调用，如果流未完成则部分回复和工具调用结果丢失。

AI SDK v6 已内置 resume 支持：`DefaultChatTransport`（继承 `HttpChatTransport`）有 `prepareReconnectToStreamRequest` 和 `reconnectToStream()` 方法。`useChat({ resume: true })` 在 mount 时自动调用 `resumeStream()`，发 GET 请求到重连端点，204 表示无活跃流，200+SSE body 表示有流可恢复。

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/agent-runner.ts` | **Create** | Agent 后台执行引擎：startAgentRun, getActiveRun, subscribeToRun, createRunStreamResponse |
| `lib/db/schema.ts` | **Modify** | 新增 `agentRuns` 和 `runEvents` 表定义 |
| `drizzle/0004_resumable_streaming.sql` | **Create** | 数据库迁移 SQL |
| `app/api/chat/route.ts` | **Modify** | POST handler 改为委托 AgentRunner，返回 EventEmitter 支撑的 SSE 流 |
| `app/api/chat/stream/route.ts` | **Create** | GET 重连端点，供 `reconnectToStream()` 调用 |
| `components/chat-shell.tsx` | **Modify** | 添加 `resume: true` + `prepareReconnectToStreamRequest`，调整恢复逻辑 |
| `lib/db/client.ts` | **Modify** | 启动时标记崩溃的 runs |

---

### Task 1: Database Schema — 新增 agentRuns 和 runEvents 表

**Files:**
- Modify: `lib/db/schema.ts:61` (在 toolCalls 表之后添加)
- Create: `drizzle/0004_resumable_streaming.sql`

- [ ] **Step 1: 在 schema.ts 中添加表定义**

在 `toolCalls` 表定义之后添加：

```typescript
export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    finishedAt: integer("finished_at", { mode: "number" }),
  },
  (table) => [
    index("agent_runs_conversation_idx").on(table.conversationId, table.createdAt),
    index("agent_runs_status_idx").on(table.status),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    eventData: text("event_data").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("run_events_run_id_idx").on(table.runId, table.id),
  ],
);
```

- [ ] **Step 2: 创建迁移文件**

创建 `drizzle/0004_resumable_streaming.sql`：

```sql
CREATE TABLE `agent_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL REFERENCES `conversations`(`id`) ON DELETE CASCADE,
  `status` text NOT NULL DEFAULT 'running',
  `created_at` integer NOT NULL,
  `finished_at` integer
);

CREATE INDEX `agent_runs_conversation_idx` ON `agent_runs` (`conversation_id`, `created_at`);
CREATE INDEX `agent_runs_status_idx` ON `agent_runs` (`status`);

CREATE TABLE `run_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_id` text NOT NULL REFERENCES `agent_runs`(`id`) ON DELETE CASCADE,
  `conversation_id` text NOT NULL REFERENCES `conversations`(`id`) ON DELETE CASCADE,
  `event_data` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX `run_events_run_id_idx` ON `run_events` (`run_id`, `id`);
```

同时在 `drizzle/meta/_journal.json` 中添加对应的迁移条目（参考现有条目格式）。

- [ ] **Step 3: 验证迁移**

Run: `pnpm build`
Expected: 构建成功，迁移能正常应用

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts drizzle/0004_resumable_streaming.sql drizzle/meta/_journal.json
git commit -m "feat: add agentRuns and runEvents tables for resumable streaming"
```

---

### Task 2: AgentRunner 核心模块

**Files:**
- Create: `lib/agent-runner.ts`

这是整个功能的核心。AgentRunner 管理 Agent 的后台执行，通过 EventEmitter 推送实时事件，同时将事件写入 SQLite 用于重连回放。

- [ ] **Step 1: 创建 AgentRunner 类型定义和模块结构**

创建 `lib/agent-runner.ts`，定义核心类型和模块级状态：

```typescript
import "server-only";

import { EventEmitter } from "events";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { db, ensureDatabase } from "@/lib/db/client";
import { agentRuns, runEvents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { persistFinishedConversation, generateConversationTitle } from "@/lib/persistence";
import type { AgentTimelineStep, ChatUIMessage } from "@/lib/observability";
import type { ProviderConfig } from "@/lib/settings";

interface ActiveRun {
  runId: string;
  conversationId: string;
  buffer: string[];           // 缓冲的 SSE 事件字符串
  emitter: EventEmitter;      // 实时事件通知
  status: "running" | "finished" | "error";
}

// 模块级单例状态
const activeRuns = new Map<string, ActiveRun>();       // conversationId → ActiveRun
const activeRunsByRunId = new Map<string, ActiveRun>(); // runId → ActiveRun
```

- [ ] **Step 2: 实现 startAgentRun 函数**

这个函数启动 Agent 后台执行。核心逻辑从 `app/api/chat/route.ts` 的 POST handler 中提取。

```typescript
export async function startAgentRun(params: {
  runId: string;
  conversationId: string;
  messages: ChatUIMessage[];
  systemPrompt: string;
  tools: ToolSet;
  model: LanguageModel;
  providerConfig: ProviderConfig;
}): Promise<void> {
  const { runId, conversationId, messages, systemPrompt, tools, model, providerConfig } = params;

  await ensureDatabase();

  // 如果该对话已有活跃 run，先中止
  const existingRun = activeRuns.get(conversationId);
  if (existingRun && existingRun.status === "running") {
    existingRun.status = "error";
    existingRun.emitter.emit("done");
  }

  // 创建 DB 记录
  const now = Date.now();
  db.insert(agentRuns).values({
    id: runId,
    conversationId,
    status: "running",
    createdAt: now,
  }).run();

  // 创建内存状态
  const run: ActiveRun = {
    runId,
    conversationId,
    buffer: [],
    emitter: new EventEmitter(),
    status: "running",
  };
  activeRuns.set(conversationId, run);
  activeRunsByRunId.set(runId, run);

  // 异步启动 Agent（fire-and-forget）
  runAgent(run, params).catch((err) => {
    console.error(`Agent run ${runId} failed:`, err);
    run.status = "error";
    run.emitter.emit("done");
    db.update(agentRuns)
      .set({ status: "error", finishedAt: Date.now() })
      .where(eq(agentRuns.id, runId))
      .run();
  });
}
```

- [ ] **Step 3: 实现 runAgent 内部函数**

这是实际执行 `streamText()` 并将 SSE 事件分发到 EventEmitter + DB 的函数。

关键点：
- 使用 `result.toUIMessageStream()` 获取 `ReadableStream<UIMessageStreamPart>`
- 将每个 part 序列化为 SSE 格式字符串 `data: ${JSON.stringify(part)}\n\n`
- 每个事件同时写入 `run.buffer`、`emitter.emit` 和 `db.insert(runEvents)`
- 流结束后发送 `data: [DONE]\n\n`，更新状态，调用 `persistFinishedConversation`
- 保留现有的 timeline/observability 逻辑（从 route.ts 移过来）

```typescript
async function runAgent(run: ActiveRun, params: {
  runId: string;
  conversationId: string;
  messages: ChatUIMessage[];
  systemPrompt: string;
  tools: ToolSet;
  model: LanguageModel;
  providerConfig: ProviderConfig;
}): Promise<void> {
  const { runId, conversationId, messages: chatMessages, systemPrompt, tools, model, providerConfig } = params;

  const requestStartedAt = Date.now();
  const stepStartTimes = new Map<number, number>();
  const timeline: AgentTimelineStep[] = [];
  let requestFinishedAt: number | undefined;

  const modelMessages = await convertToModelMessages(
    chatMessages.map((m) => { const { id, ...rest } = m; return rest; }),
    { tools },
  );

  const result = streamText({
    model,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    onStepStart: ({ stepNumber }) => {
      stepStartTimes.set(stepNumber, Date.now());
    },
    onStepEnd: (step) => {
      // 同 route.ts 中现有的 timeline 收集逻辑
      const finishedAt = Date.now();
      const startedAt = stepStartTimes.get(step.stepNumber) ?? finishedAt;
      timeline.push({
        event: "step-finish",
        stepNumber: step.stepNumber,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        finishReason: step.finishReason,
        provider: step.model.provider,
        modelId: step.model.modelId,
        text: step.text,
        toolCalls: step.toolCalls.map((tc) => ({ toolCallId: tc.toolCallId, toolName: tc.toolName })),
        toolResults: step.toolResults.map((tr) => ({ toolCallId: tr.toolCallId, toolName: tr.toolName })),
        usage: {
          inputTokens: Math.max(0, Math.round(step.usage.inputTokens ?? 0)),
          outputTokens: Math.max(0, Math.round(step.usage.outputTokens ?? 0)),
          totalTokens: Math.max(0, Math.round(step.usage.totalTokens ?? 0)),
          reasoningTokens: Math.max(0, Math.round(step.usage.outputTokenDetails.reasoningTokens ?? step.usage.reasoningTokens ?? 0)),
          cachedInputTokens: Math.max(0, Math.round(step.usage.inputTokenDetails.cacheReadTokens ?? step.usage.cachedInputTokens ?? 0)),
        },
      });
      stepStartTimes.delete(step.stepNumber);
    },
  });

  // 使用 toUIMessageStream 获取消息流，附带 messageMetadata
  const uiStream = result.toUIMessageStream({
    originalMessages: chatMessages,
    messageMetadata: ({ part }) => {
      if (part.type === "start") {
        return { createdAt: requestStartedAt, status: "streaming" as const, startedAt: requestStartedAt, timeline: [] };
      }
      if (part.type === "finish-step") {
        return { createdAt: requestStartedAt, status: "streaming" as const, startedAt: requestStartedAt, timeline };
      }
      if (part.type === "finish") {
        requestFinishedAt ??= Date.now();
        return {
          createdAt: requestStartedAt, status: "finished" as const, startedAt: requestStartedAt,
          finishedAt: requestFinishedAt,
          totalDurationMs: Math.max(0, requestFinishedAt - requestStartedAt),
          timeline,
        };
      }
    },
    onFinish: async ({ messages: finishedMessages }) => {
      await persistFinishedConversation(conversationId, finishedMessages);

      const userMsgs = finishedMessages.filter((m) => m.role === "user");
      const assistantMsgs = finishedMessages.filter((m) => m.role === "assistant");
      if (userMsgs.length === 1 && assistantMsgs.length === 1) {
        generateConversationTitle(conversationId, finishedMessages, providerConfig).catch(console.error);
      }
    },
  });

  // 消费 UI stream，将每个 chunk 序列化为 SSE 并分发
  const reader = uiStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const sseString = `data: ${JSON.stringify(value)}\n\n`;
      emitEvent(run, sseString);
    }
  } finally {
    reader.releaseLock();
  }

  // 发送 DONE 信号
  emitEvent(run, "data: [DONE]\n\n");

  // 标记完成
  run.status = "finished";
  run.emitter.emit("done");
  db.update(agentRuns)
    .set({ status: "finished", finishedAt: Date.now() })
    .where(eq(agentRuns.id, runId))
    .run();

  // 延迟清理内存（给重连留 60 秒窗口）
  setTimeout(() => cleanupRun(runId, conversationId), 60_000);
}
```

- [ ] **Step 4: 实现辅助函数**

```typescript
function emitEvent(run: ActiveRun, sseString: string): void {
  run.buffer.push(sseString);
  run.emitter.emit("event", sseString);

  // 持久化到 DB
  db.insert(runEvents).values({
    runId: run.runId,
    conversationId: run.conversationId,
    eventData: sseString,
    createdAt: Date.now(),
  }).run();
}

function cleanupRun(runId: string, conversationId: string): void {
  const run = activeRunsByRunId.get(runId);
  if (run && run.status !== "running") {
    activeRuns.delete(conversationId);
    activeRunsByRunId.delete(runId);
  }
  // 清理 DB 事件（已持久化到 messages 表的不再需要）
  db.delete(runEvents).where(eq(runEvents.runId, runId)).run();
}

export function getActiveRun(conversationId: string): ActiveRun | null {
  const run = activeRuns.get(conversationId);
  return run && run.status === "running" ? run : null;
}

export function markCrashedRuns(): void {
  db.update(agentRuns)
    .set({ status: "crashed", finishedAt: Date.now() })
    .where(eq(agentRuns.status, "running"))
    .run();
}
```

- [ ] **Step 5: 实现 createRunStreamResponse 函数**

这个函数创建一个 SSE Response，从 EventEmitter buffer 回放 + 实时推送：

```typescript
export function createRunStreamResponse(
  runId: string,
  conversationId: string,
  abortSignal?: AbortSignal,
): Response {
  // 优先从内存获取
  let run = activeRunsByRunId.get(runId);

  // 内存中没有（进程重启过），尝试从 DB 回放
  if (!run) {
    const dbRun = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).all()[0];
    if (!dbRun || dbRun.status !== "running") {
      return new Response(null, { status: 204 });
    }
    // 进程重启后的 running 状态不可能恢复，标记为 crashed
    db.update(agentRuns)
      .set({ status: "crashed", finishedAt: Date.now() })
      .where(eq(agentRuns.id, runId))
      .run();
    return new Response(null, { status: 204 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 1. 回放已缓冲的事件
      for (const event of run.buffer) {
        controller.enqueue(encoder.encode(event));
      }

      // 2. 如果已完成，直接关闭
      if (run.status !== "running") {
        controller.close();
        return;
      }

      // 3. 订阅实时事件
      const onEvent = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller 已关闭
        }
      };
      const onDone = () => {
        run.emitter.off("event", onEvent);
        try { controller.close(); } catch {}
      };

      run.emitter.on("event", onEvent);
      run.emitter.once("done", onDone);

      // 4. 客户端断开时清理订阅（不影响 Agent 运行）
      abortSignal?.addEventListener("abort", () => {
        run.emitter.off("event", onEvent);
        run.emitter.off("done", onDone);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 6: 验证模块编译**

Run: `pnpm build`
Expected: 编译通过（此时还没有消费者调用，仅验证模块本身无错误）

- [ ] **Step 7: Commit**

```bash
git add lib/agent-runner.ts
git commit -m "feat: add AgentRunner module for background agent execution with EventEmitter + DB event log"
```

---

### Task 3: 修改 POST /api/chat — 委托 AgentRunner

**Files:**
- Modify: `app/api/chat/route.ts`

将 `streamText()` 调用和 `toUIMessageStreamResponse()` 替换为 AgentRunner 委托。POST 仍然返回 SSE 流（保持 `DefaultChatTransport` 兼容），但流的来源变为 EventEmitter。

- [ ] **Step 1: 更新 imports 和 maxDuration**

```typescript
// 新增
import { startAgentRun, createRunStreamResponse } from "@/lib/agent-runner";

// 修改
export const maxDuration = 300; // 从 30 增到 300，Agent 可能运行更久
```

移除不再需要的 imports：`streamText`, `convertToModelMessages`, `stepCountIs` (这些移到了 agent-runner.ts)

- [ ] **Step 2: 重写 POST handler 的后半部分**

保留验证、provider 配置、sanitize、persistIncomingMessages 等前半部分不变（lines 129-166）。

替换 lines 168-272（从 `const requestStartedAt = Date.now()` 开始到函数结束）为：

```typescript
  const runId = crypto.randomUUID();

  await startAgentRun({
    runId,
    conversationId: parsed.data.conversationId,
    messages: sanitizedMessages,
    systemPrompt: runtimeSystemPrompt,
    tools: agentTools,
    model: getChatModel(providerConfig),
    providerConfig,
  });

  return createRunStreamResponse(runId, parsed.data.conversationId, request.signal);
```

从 imports 中移除 `after`（不再需要），移除 `streamText`, `convertToModelMessages`, `stepCountIs`。
保留 `persistIncomingMessages` import。移除 `persistFinishedConversation` 和 `generateConversationTitle`。移除 `AgentTimelineStep` type import。

- [ ] **Step 3: 验证**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "refactor: delegate agent execution to AgentRunner in POST /api/chat"
```

---

### Task 4: 创建 GET 重连端点

**Files:**
- Create: `app/api/chat/stream/route.ts`

AI SDK 的 `HttpChatTransport.reconnectToStream()` 发送 GET 请求。我们通过 `prepareReconnectToStreamRequest` 自定义 URL 为 `/api/chat/stream?conversationId=xxx`。

- [ ] **Step 1: 创建 GET route handler**

```typescript
import { getActiveRun, createRunStreamResponse } from "@/lib/agent-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");

  if (!conversationId) {
    return new Response(null, { status: 204 });
  }

  const activeRun = getActiveRun(conversationId);

  if (!activeRun) {
    return new Response(null, { status: 204 });
  }

  return createRunStreamResponse(
    activeRun.runId,
    conversationId,
    request.signal,
  );
}
```

- [ ] **Step 2: 验证**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat: add GET /api/chat/stream endpoint for SSE reconnection"
```

---

### Task 5: 客户端 — 启用 resume 和重连

**Files:**
- Modify: `components/chat-shell.tsx`

- [ ] **Step 1: 给 transport 添加 prepareReconnectToStreamRequest**

在 `chat-shell.tsx` 的 transport 初始化中（约 line 123-146），在 `prepareSendMessagesRequest` 之后添加 `prepareReconnectToStreamRequest`：

```typescript
const [transport] = useState(
  () =>
    new DefaultChatTransport<ChatUIMessage>({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ body, id, messages }) => {
        // ... 现有逻辑不变 ...
      },
      prepareReconnectToStreamRequest: () => {
        const cid = conversationIdRef.current;
        if (!cid) return {};
        return { api: `/api/chat/stream?conversationId=${cid}` };
      },
    }),
);
```

- [ ] **Step 2: 给 useChat 添加 resume: true**

在 `useChat` 调用中（约 line 202-208）添加 `resume: true`：

```typescript
useChat<ChatUIMessage>({
  id: CHAT_INSTANCE_ID,
  messages: currentMessages,
  messageMetadataSchema: agentObservabilitySchema,
  transport,
  resume: true,
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
});
```

- [ ] **Step 3: 调整 stream recovery 超时**

现有的 20 秒 idle recovery（line 384-418）会在流暂时断开时过早地将消息标记为 interrupted。有了 resume 后，客户端会自动重连，不应该那么快放弃。

将 `STREAM_RECOVERY_IDLE_MS` 从 `20000` 增大到 `60000`（60 秒），给重连更多时间：

```typescript
const STREAM_RECOVERY_IDLE_MS = 60000;
```

- [ ] **Step 4: 验证**

Run: `pnpm lint && pnpm build`
Expected: lint 和 build 都通过

- [ ] **Step 5: Commit**

```bash
git add components/chat-shell.tsx
git commit -m "feat: enable resumable streaming with useChat resume:true and reconnect transport"
```

---

### Task 6: 进程重启处理

**Files:**
- Modify: `lib/db/client.ts`

- [ ] **Step 1: 在 ensureDatabase 中标记崩溃的 runs**

在 `lib/db/client.ts` 的 `ensureDatabase()` 函数中，在 migrations 之后添加 `markCrashedRuns()` 逻辑。

注意循环依赖：`agent-runner.ts` imports from `lib/db/client.ts`，所以 `client.ts` 不能 import `agent-runner.ts`。将逻辑直接内联：

```typescript
import { eq } from "drizzle-orm";

function markCrashedRuns() {
  db.update(schema.agentRuns)
    .set({ status: "crashed", finishedAt: Date.now() })
    .where(eq(schema.agentRuns.status, "running"))
    .run();
}

// 在 ensureDatabase 函数中
initializationPromise = Promise.resolve().then(() => {
  migrate(db, { migrationsFolder: migrationsFolderPath });
  seedDefaultNotes();
  seedDefaultTodos();
  markCrashedRuns();
});
```

- [ ] **Step 2: 验证**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add lib/db/client.ts
git commit -m "feat: mark orphaned agent runs as crashed on process startup"
```

---

### Task 7: 集成测试和清理

**Files:**
- Modify: `TODO.md` (更新已完成项)

- [ ] **Step 1: 端到端手动测试**

启动 dev server：`pnpm dev`

测试场景 1 — 正常流式：
1. 发送一条消息
2. 观察 Agent 正常回复（包含文字和工具调用）
3. 回复完成后消息正确持久化

测试场景 2 — 关闭页面后重连：
1. 发送一条需要多步工具调用的消息（如 "搜索最新的 AI 新闻并总结"）
2. 在 Agent 回复过程中关闭浏览器 tab
3. 等待 5-10 秒后重新打开同一对话
4. 验证：消息从断点继续流式显示

测试场景 3 — 流已完成后打开：
1. 发送一条消息
2. 关闭页面
3. 等待 Agent 完成（>30 秒）
4. 重新打开 → 应看到完整的回复（从 DB 加载）

测试场景 4 — 工具审批：
1. 发送触发需要审批的工具调用的消息
2. 关闭页面，重新打开
3. 验证审批请求仍然显示，可以批准/拒绝

- [ ] **Step 2: 检查 pnpm lint && pnpm build**

Run: `pnpm lint && pnpm build`
Expected: 全部通过

- [ ] **Step 3: 更新 TODO.md**

在 TODO.md 中标记 resumable streaming 功能为已完成，记录任何已知限制。

- [ ] **Step 4: Final commit**

```bash
git add TODO.md
git commit -m "docs: update TODO.md with resumable streaming completion"
```

---

## Verification

完整的验证流程：

1. **编译验证**: `pnpm lint && pnpm build` 全部通过
2. **正常流式**: 发消息 → 收到完整回复 → 消息持久化正常
3. **断线重连**: 发消息 → 关闭页面 → 重新打开 → 流从断点继续
4. **流完成后打开**: 发消息 → 关闭页面 → 等待完成 → 重新打开 → 看到完整回复
5. **工具调用**: 包含工具调用的消息也能正确恢复
6. **进程重启**: 重启 dev server → 之前 running 的 run 标记为 crashed → 用户看到 interrupted 状态

## Known Limitations

- **进程重启不可恢复**: 如果 Node 进程在 Agent 运行中重启，该 run 会被标记为 crashed，用户看到 interrupted 状态。这是单进程架构的固有限制。
- **内存使用**: 每个活跃 run 的 buffer 在内存中保存所有 SSE 事件。一个典型的 5 步 Agent run 大约几 KB，不是问题。但如果并发 run 很多，需要考虑内存压力。
- **不支持跨设备恢复**: resume 只在同一浏览器 session 的 useChat 实例中生效。不同设备打开同一对话只能看到 DB 中已持久化的消息。
