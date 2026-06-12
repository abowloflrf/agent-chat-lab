# Usage Stats Dashboard 设计方案

## Context

当前每条 assistant 消息的 `metadata_json` 已包含完整的 `AgentObservability` 数据（token 用量、模型信息、性能指标），但以 JSON blob 形式嵌在 messages 表中，无法高效做聚合查询。需要新增结构化存储 + 统计页面，满足"个人仪表盘 + 性能洞察"的需求。

同时，历史会话目前只能在侧边窄栏看到标题，信息密度太低。本需求一并集成一个**会话管理**视图：以高信息密度表格展示所有会话（标题、创建时间、最后对话时间、输入/输出 Tokens、缓存命中率、对话轮次、最后使用模型、当前上下文大小），按最后对话时间倒序，支持快速搜索和批量删除。

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

在 `app/api/stats/` 下新建四个 GET 端点：

| 路由 | 返回 | 主要查询 |
|------|------|----------|
| `/api/stats/overview` | 总对话数、总 token、总工具调用、总耗时 | `SUM/COUNT` on usage_records |
| `/api/stats/models` | 各模型的 token 分布、调用次数、平均延迟 | `GROUP BY model_id, provider` |
| `/api/stats/trends?days=30` | 每天的 token、对话数、工具调用 | `GROUP BY day_key, model_id` + `WHERE day_key >= ?` |
| `/api/stats/conversations` | 全量会话列表（含聚合列），按 last_message_at 倒序 | conversations LEFT JOIN 聚合子查询 |

查询函数放在 `lib/persistence.ts`，路由文件只做参数校验 + 调用。

### 会话列表查询（`listConversationStats`）

`conversations` 表 LEFT JOIN 三个聚合子查询，单条 SQL 完成：

| 列 | 来源 |
|----|------|
| 标题 / 创建时间 / 最后对话时间 | `conversations.title / created_at / last_message_at` |
| 对话轮次 | `COUNT(messages WHERE role='user') GROUP BY conversation_id` |
| 输入 Tokens | `SUM(usage_records.input_tokens) GROUP BY conversation_id` |
| 输出 Tokens | `SUM(usage_records.output_tokens) GROUP BY conversation_id` |
| 缓存命中率 | `SUM(cached_input_tokens) / SUM(input_tokens)`（与模型表格口径一致；输入为 0 时显示 "—"） |
| 最后使用模型 | 该会话最新一条 usage_record 的 `model_id` |
| 当前上下文大小 | `MAX(usage_records.input_tokens)`，即该会话单次请求携带的最大上下文 |

**"当前上下文大小"口径：** 取所有 step 中 `input_tokens` 的最大值，与 chat-shell 顶部状态栏的 `currentContextLength` 完全一致。比"最新 step 的 total_tokens"更稳健——不受末条消息流式中断（未写 metadata）影响。

**"最新一条 usage_record"的取法：** `WHERE id IN (SELECT MAX(id) FROM usage_records GROUP BY conversation_id)`。成立的前提是写入路径每次对单个会话整体重写（先删后按 timeline 顺序插入），因此会话内自增 id 最大的行就是最新 step。

**缺数据处理：** 没有 usage_records 的会话（如从未完成过一次回复）LEFT JOIN 后相应列为 NULL，前端显示 "—"。

**搜索与分页：** 接口返回全量（个人应用规模小），不做分页；搜索在前端按标题即时过滤，不加 `?q=` 参数。

## 5. 前端：集成进系统设置

不新增独立页面，而是作为**系统设置（`/settings`）下的两个子 tab**，与"模型配置""工具配置"同级。`ProviderSettingsForm` 的 `activeSection` 类型扩展为 `"model" | "tools" | "stats" | "conversations"`，侧栏与移动端头部各加两个 tab 按钮。统计/会话两个面板**放在保存 `<form>` 之外**（它们是只读 + 删除，不应触发设置保存）。

**组件拆分：**

```
components/
  stats-dashboard.tsx        — 用量统计面板（无页面壳）：拉 overview/models + 刷新
  stats-overview-cards.tsx   — 4 个汇总卡片（会话数/大模型调用次数/总 token/工具调用）
  stats-model-table.tsx      — 模型维度表格（含 provider、token 分布、命中率、平均延迟、平均生成速度）
  stats-trend-chart.tsx      — 趋势图（Recharts 堆叠柱状图 + 时间范围切换，自管 trends 数据）
  conversations-manager.tsx  — 会话管理面板（无页面壳）：搜索 + 多选 + 表格 + 删除
```

**「用量统计」tab 布局：**
```
+----------------------------------------------------------------+
| 用量统计 …说明…                                      [刷新按钮]  |
+----------------------------------------------------------------+
| [总会话数]  [大模型调用]  [总 Tokens]  [总工具调用]              |
+----------------------------------------------------------------+
| Token 消耗趋势                      [近7天|近30天|近90天]        |
| （Recharts 堆叠柱状图，按模型分色，hover 显示明细）              |
+----------------------------------------------------------------+
| 模型用量明细（全宽）                                            |
| 模型/供应商  调用  输入  输出  命中率  平均延迟  平均速度        |
+----------------------------------------------------------------+
```
没有单独的全局"性能洞察"面板 —— 延迟、命中率、生成速度都按模型在明细表里逐行展示。

**「会话管理」tab 布局：**
```
+--------------------------------------------------------------------+
| 会话管理 …说明…                                          [刷新按钮]  |
+--------------------------------------------------------------------+
| [🔍 按标题搜索…]                  已选 N 项 [删除所选]    共 N 个会话  |
+--------------------------------------------------------------------+
| ☑ | 标题   | 创建时间 | 最后对话 | 输入 | 输出 | 命中率 | 轮次 | 模型 | 上下文 | ✕ |
| （按最后对话时间倒序，紧凑行高）                                       |
+--------------------------------------------------------------------+
```

**会话管理交互：**
- 点击行跳转 `/?conversationId=<id>` 打开对应会话（离开设置进入聊天，复用现有路由参数）
- 行首 checkbox 多选，表头 checkbox 全选/反选**当前过滤结果**；选中项的计数与「删除所选」均限定在**当前可见行**（避免删除被搜索隐藏的选中项），`window.confirm` 二次确认后批量删除
- 行尾删除按钮复用 `DELETE /api/conversations/[id]`，确认后删除并本地移除该行
- 创建时间列用绝对时间（MM-DD HH:mm），最后对话列用相对时间（如"3 小时前"），均 hover 显示完整时间；Token/上下文列用 `k`/`M` 缩写

**批量删除 API：** 在现有 `app/api/conversations/route.ts` 增加 `DELETE` 方法，body 为 `{ ids: string[] }`，单事务内显式删除 usage_records / tool_calls / messages / conversations（与 `deleteConversation` 一致），返回真实删除行数 `changes`。

**趋势图（Recharts）：**
- 用 `recharts` 的 `BarChart` 堆叠柱状图，按模型分色（与图例同色），自定义 Tooltip 显示当天各模型 token 明细 + 合计
- 顶部按钮组切换时间范围（近 7 / 30 / 90 天），切换时只重新请求 `/api/stats/trends?days=N`；父组件刷新通过 `refreshToken` prop 触发图表静默重拉
- 前端按所选范围生成**连续日期轴**（缺数据的天补 0），柱子等距
- 初始 `loading=true`，SSR/prerender 只渲染占位文案、不渲染 Recharts，规避图表库在服务端无尺寸的问题

**设计决策：**
- **时间粒度**：按天，支持 7/30/90 天范围切换
- **性能指标**：不做全局汇总面板，延迟 / 缓存命中率 / 平均生成速度都按模型逐行放进明细表（生成速度 = 该模型输出 token / 总生成时长）
- **数据刷新**：tab 加载时获取 + 面板右上角手动刷新按钮（不做自动轮询）
- **字体**：所有数值类（token、延迟、命中率、轮次、上下文、模型 id、时间、图表坐标轴/Tooltip）统一用 mono 字体（IBM Plex Mono，经 Tailwind `--font-mono` 映射），对齐更整齐
- **样式**：复用现有暖色调风格（`agent-timeline.tsx`, `chat-shell.tsx`），Tailwind；图表库仅引入 Recharts

**导航入口：** 即系统设置内的两个子 tab，无需在 `module-switcher.tsx` 另设入口。

## 6. 迁移文件

通过 `pnpm db:generate` 自动生成（改 `schema.ts` 后由 drizzle-kit 产出 SQL + snapshot + journal）。实际生成的是 `drizzle/0005_uneven_plazm.sql`（`0004` 已被 mcp_servers 迁移占用），并自动更新 `drizzle/meta/_journal.json` 与 `drizzle/meta/0005_snapshot.json`。迁移在运行时由 `ensureDatabase()` 的 `migrate()` 自动应用，无需 CLI。

## 7. 实施顺序

1. Schema + Migration（schema.ts 加 usageRecords 表 + `pnpm db:generate` 生成 0005）
2. 共享层（`lib/datetime.ts` 加 day_key、新建 `lib/format.ts` 共享格式化、新建 `lib/usage-records.ts` 展开 timeline → 行）
3. Write path（persistence.ts 中 saveConversationSnapshot 增加 usage_records 写入）
4. Backfill（client.ts 中 ensureDatabase 增加回填逻辑）
5. Query functions（persistence.ts 新增 4 个查询函数，含 listConversationStats + batchDeleteConversations）
6. API routes（app/api/stats/ 四个路由 + conversations 路由加 DELETE）
7. Frontend（6 个组件 + Recharts 趋势图，两个面板做成无壳内容）
8. 集成进系统设置（`provider-settings-form.tsx` 扩展 `activeSection`、加两个 tab、内容区在 `<form>` 外分发统计/会话面板）

## 8. 验证

- `pnpm lint && pnpm build` 通过
- 启动后发送几条消息，检查 `usage_records` 表有数据
- 系统设置 →「用量统计」tab：4 个汇总卡片、趋势图（含 7/30/90 天范围切换）、模型明细（含 provider 与平均生成速度）展示正确
- 系统设置 →「会话管理」tab：列表字段与排序正确，搜索即时过滤，点击行能打开对应会话
- 批量删除：多选若干会话删除后，数据库中对应 messages / usage_records 均被 CASCADE 清理
- 删除一个对话，确认 CASCADE 清理了对应的 usage_records
