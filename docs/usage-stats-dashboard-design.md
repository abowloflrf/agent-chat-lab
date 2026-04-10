# Usage Stats Dashboard 设计方案

## Context

当前每条 assistant 消息的 `metadata_json` 已包含完整的 `AgentObservability` 数据（token 用量、模型信息、性能指标），但以 JSON blob 形式嵌在 messages 表中，无法高效做聚合查询。需要新增结构化存储 + 统计页面，满足"个人仪表盘 + 性能洞察"的需求。

## 1. 新表 `usage_records` — 每 step 一行

在 `lib/db/schema.ts` 新增表，每个 `AgentTimelineStep` 展开为一行：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK AUTO | - |
| conversation_id | TEXT FK | -> conversations.id, CASCADE |
| message_id | TEXT FK | -> messages.id, CASCADE |
| step_number | INTEGER | step 序号 |
| provider | TEXT | 如 "openai" |
| model_id | TEXT | 如 "gpt-4o" |
| finish_reason | TEXT | "end-turn" / "tool-calls" 等 |
| input_tokens | INTEGER | 输入 token |
| output_tokens | INTEGER | 输出 token |
| total_tokens | INTEGER | 总 token |
| reasoning_tokens | INTEGER | 深度思考 token |
| cached_input_tokens | INTEGER | 缓存命中 token |
| duration_ms | INTEGER | 该 step 耗时 |
| tool_call_count | INTEGER | 该 step 工具调用数 |
| started_at | INTEGER | 毫秒时间戳 |
| finished_at | INTEGER | 毫秒时间戳 |
| day_key | INTEGER | YYYYMMDD 整数，便于 GROUP BY |

索引：`(day_key, model_id)`, `(conversation_id)`, `(model_id)`

**设计要点：**
- 粒度是 step（不是 message），因为一条 assistant 消息可包含多个 step（多步 agent 循环），且不同 step 可能使用不同模型
- `day_key` 用 Asia/Shanghai 时区的 YYYYMMDD 整数，避免 GROUP BY 时的字符串操作
- CASCADE 删除，清理对话时自动清理统计数据

## 2. 数据写入

**时机：** `saveConversationSnapshot` 中，与 `toolCalls` 同步写入（仅 `syncToolCalls: true` 时，即 `persistFinishedConversation`）

**逻辑：** 在已有事务内，紧跟 toolCalls 写入之后：
1. 删除该 conversationId 的所有 usage_records
2. 遍历 assistant 消息，解析 metadata → `parseAgentObservability()`
3. 展开 `timeline[]` 中每个 step，批量 INSERT

**关键文件：** `lib/persistence.ts` — `saveConversationSnapshot` 函数

## 3. 历史数据回填

在 `lib/db/client.ts` 的 `ensureDatabase()` 中，migrate 之后自动执行一次：
- 检查 `usage_records` 表是否为空
- 若空，扫描所有 `role='assistant'` 且 `metadata_json IS NOT NULL` 的消息
- 解析并批量写入（每 50 行一批，避免 SQLite 变量数限制）

## 4. API 路由

在 `app/api/stats/` 下新建三个 GET 端点：

| 路由 | 返回 | 主要查询 |
|------|------|----------|
| `/api/stats/overview` | 总对话数、总 token、总工具调用、总耗时 | `SUM/COUNT` on usage_records |
| `/api/stats/models` | 各模型的 token 分布、调用次数、平均延迟 | `GROUP BY model_id, provider` |
| `/api/stats/trends?days=30` | 每天的 token、对话数、工具调用 | `GROUP BY day_key, model_id` + `WHERE day_key >= ?` |

查询函数放在 `lib/persistence.ts`，路由文件只做参数校验 + 调用。

## 5. 前端页面

**新页面：** `app/stats/page.tsx`

**组件拆分：**

```
components/
  stats-dashboard.tsx       — 主布局 + 数据获取 + 手动刷新按钮
  stats-overview-cards.tsx  — 4 个汇总卡片（对话数/总 token/工具调用/总耗时）
  stats-model-table.tsx     — 模型维度表格（token 分布 + 缓存命中率列）
  stats-performance.tsx     — 性能面板（全局平均延迟/全局缓存命中率/生成速率）
  stats-trend-chart.tsx     — 时间趋势图（按天，纯 SVG 柱状图，不引入图表库）
```

**页面布局：**
```
+---------------------------------------------------+
| <- 返回聊天     用量统计                 [刷新按钮]  |
+---------------------------------------------------+
| [总对话数]  [总 Tokens]  [总工具调用]  [总耗时]      |
+---------------------------------------------------+
| Token 消耗趋势（按天，堆叠柱状图）                    |
+---------------------------------------------------+
| 模型用量明细                      | 性能洞察         |
| model  in  out  cache  命中率     | 平均延迟         |
|                                  | 缓存命中率(全局)  |
|                                  | 生成速率          |
+---------------------------------------------------+
```

**设计决策：**
- **时间粒度**：仅按天，不做周/月切换
- **缓存命中率**：全局百分比放性能面板 + 模型表格中每个模型一列
- **数据刷新**：页面加载时获取 + 右上角手动刷新按钮（不做自动轮询）
- **样式**：复用现有暖色调风格（`agent-timeline.tsx`, `chat-shell.tsx`），纯 Tailwind，不引入第三方 UI 库

**导航入口：** 在 `chat-shell.tsx` 侧边栏的"系统设置"旁新增"用量统计"链接。

## 6. 迁移文件

新建 `drizzle/0004_usage_records.sql`，更新 `drizzle/meta/_journal.json`。

## 7. 实施顺序

1. Schema + Migration（schema.ts + 0004 SQL + journal）
2. Write path（persistence.ts 中 saveConversationSnapshot 增加 usage_records 写入）
3. Backfill（client.ts 中 ensureDatabase 增加回填逻辑）
4. Query functions（persistence.ts 新增 3 个查询函数）
5. API routes（app/api/stats/ 三个路由）
6. Frontend（stats 页面 + 5 个组件）
7. Navigation（chat-shell.tsx 加入口）

## 8. 验证

- `pnpm lint && pnpm build` 通过
- 启动 dev，发送几条消息后检查 `usage_records` 表有数据
- 访问 `/stats` 页面，确认数据展示正确
- 删除一个对话，确认 CASCADE 清理了对应的 usage_records
