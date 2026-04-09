# Agent Chat Lab

一个从 0 开始学习 Agent 构建流程的教学型 Web 应用。

当前阶段目标很明确: 先做出一个最小、可解释、可运行的 Agent 聊天应用，让你看清下面这条主链路:

1. 用户输入消息
2. 服务端拼接系统提示词与历史消息
3. 模型决定是否调用工具
4. 本地工具执行
5. 工具结果回填给模型
6. 模型产出最终回复

## 技术栈

- Next.js 16
- TypeScript
- Tailwind CSS 4
- Vercel AI SDK 6
- OpenAI Provider
- SQLite + Drizzle ORM
- Zod

## 当前已实现

### 聊天与 Agent

- 聊天 Web 界面，支持键盘快捷键与自动滚动
- `/api/chat` Route Handler
- 基于 `streamText` 的最小 Agent loop
- 对工具调用过程的前端可视化
- 完整 Agent timeline 展示（每步耗时、step finish 事件）
- 当前上下文长度实时展示
- 异常中断恢复与上一轮回复重生成

### 内置工具（8 个）

- `calculator` — 数学表达式计算
- `create_note` — 创建笔记
- `search_notes` — 搜索笔记
- `TodoWrite` — 创建/更新/完成/删除待办
- `TodoRead` — 按条件读取待办
- `WebSearch` — 基于 Tavily 的联网搜索
- `WebFetch` — 基于 Tavily 的网页内容提取
- `Bash` — Shell 命令执行（强制人工审批 + 风险拦截）

### 多供应商 & 模型管理

- 支持多个 OpenAI 兼容供应商配置（增删、启用/禁用、设为默认）
- 支持每个供应商配置多个模型（API 拉取 + 手动添加）
- 支持 `chat-completion` / `openai-response` / `anthropic-message` 三种 provider protocol
- 通过 `/models` 接口自动拉取模型列表
- Tavily API 用量进度条展示

### 会话管理

- 多会话管理（列表/创建/删除/重命名）
- 会话列表支持最近 20 条渐进展示与标题搜索
- 会话标题自动生成与手动重新生成
- 首页自动恢复最近一次会话

### 持久化

- 基于 SQLite + Drizzle ORM 的服务端持久化
- `conversation` / `message` / `tool_call` / `note` / `todo` 全部持久化
- 系统设置（供应商配置、Tavily API Key）持久化到 SQLite

### Docker 部署

- 提供 `Dockerfile` 和 `docker-compose.yml`
- 预装 Bash Tool 常用系统命令

## 项目结构

```text
app/
  api/
    chat/route.ts              # 聊天接口与 Agent loop
    conversations/route.ts     # 会话列表/创建
    conversations/[id]/route.ts       # 会话详情/更新/删除
    conversations/[id]/title/route.ts # 会话标题生成
    models/route.ts            # 代理拉取模型列表
    settings/route.ts          # 系统设置读写
    tavily-usage/route.ts      # Tavily 用量查询
    tool-stats/route.ts        # 工具执行统计
  layout.tsx                   # 全局布局
  page.tsx                     # 首页
  settings/page.tsx            # 系统设置页
components/
  agent-timeline.tsx           # Agent 执行时间线
  chat-message.tsx             # 消息渲染
  chat-shell.tsx               # 聊天主容器
  conversation-list.tsx        # 会话列表侧边栏
  model-selector.tsx           # 模型选择器
  provider-settings-form.tsx   # 供应商配置表单
  tool-call-card.tsx           # 工具调用卡片
lib/ai/
  model.ts                     # 模型配置与供应商创建
  system-prompt.ts             # 系统提示词
  tools.ts                     # 内置工具定义
  bash-server.ts               # Bash 命令执行
  bash-policy.ts               # Bash 安全策略
lib/db/
  client.ts                    # SQLite 连接与迁移初始化
  schema.ts                    # Drizzle schema
lib/
  persistence.ts               # 持久化查询与转换
  provider-config.ts           # 供应商配置 schema
  settings.ts                  # 设置管理
  observability.ts             # 可观测性
  built-in-tools.ts            # 内置工具配置
  datetime.ts                  # 日期工具
drizzle/                       # 数据库迁移文件
data/                          # 运行时数据（SQLite 文件）
```

## 本地运行

1. 安装依赖

```bash
pnpm install
```

2. 配置环境变量

```bash
cp .env.example .env.local
```

你可以二选一:

- 方式 A: 在 `.env.local` 里填 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`，如需联网搜索再补充 `TAVILY_API_KEY`
- 方式 B: 启动项目后，打开 `/settings` 页面，在界面里配置

如果两者都存在，聊天页请求会优先使用系统设置页里保存的配置。

3. 启动开发服务器

```bash
pnpm dev
```

4. 打开浏览器

```text
http://localhost:3000
```

如果 `3000` 被占用，Next.js 会自动切换到其他端口，比如 `3001`。

## Docker 运行

```bash
docker compose up -d
```

## 推荐体验顺序

先试这几句:

- `今天是周几？`
- `帮我计算 (18.5 + 7.2) * 3`
- `记住一条笔记：标题是 Agent 学习目标，内容是先学会工具调用和状态管理`
- `帮我回忆一下和 Agent 学习有关的笔记`

然后观察 UI 里出现的 tool call 卡片:

- 输入参数是什么
- 工具返回了什么
- 最终回复怎样利用这些结果

如果你要切换供应商或模型:

- 打开 `/settings`
- 添加一个供应商，输入 OpenAI 兼容的 `base URL` 和 `API Key`
- 等待页面自动调用 `/models` 拉回模型列表
- 选择模型并保存
- 如果要启用联网搜索，再填写 Tavily `API Key`

## 当前限制

- 还没有用户系统
- 还没有 RAG、文件上传
- 还没有测试框架

这些都属于下一阶段。

## 你应该重点理解什么

这个项目里最值得学的不是某个库，而是这 5 个概念:

- Prompt
- State
- Tools
- Loop
- Observability

如果你把这 5 个概念吃透，再迁移到 LangGraph、AutoGen、Mastra 或其他 Agent 框架都会快很多。
