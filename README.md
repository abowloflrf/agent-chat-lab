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
- SQLite
- Drizzle ORM
- Zod

## 当前已实现

- 一个聊天 Web 界面
- `/api/chat` Route Handler
- 基于 `streamText` 的最小 Agent loop
- 4 个内置工具:
  - `get_current_time`
  - `calculator`
  - `create_note`
  - `search_notes`
- 对工具调用过程的前端可视化
- 一个系统设置页，可配置 OpenAI 兼容供应商的 `base URL / API Key / model`
- 通过 `/models` 接口自动拉取模型列表并选择
- 基于 SQLite + Drizzle 的 conversation/message/tool_call/note 持久化
- 首页自动恢复最近一次会话

## 项目结构

```text
app/
  api/chat/route.ts      # 聊天接口与 Agent loop
  api/models/route.ts    # 代理拉取模型列表
  layout.tsx             # 全局布局
  page.tsx               # 首页
  settings/page.tsx      # 系统设置页
components/
  chat-shell.tsx         # 整体聊天页面
  chat-message.tsx       # 消息渲染
  provider-settings-form.tsx # 模型配置页面
  tool-call-card.tsx     # 工具调用卡片
lib/ai/
  model.ts               # 模型配置
  system-prompt.ts       # 系统提示词
  tools.ts               # 本地工具
lib/db/
  client.ts              # SQLite 连接与迁移初始化
  schema.ts              # Drizzle schema
lib/
  persistence.ts         # 持久化查询与转换
  provider-config.ts     # 供应商配置 schema 与本地存储 key
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

- 方式 A: 在 `.env.local` 里填 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`
- 方式 B: 启动项目后，打开 `/settings` 页面，在浏览器里配置

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

## 推荐体验顺序

先试这几句:

- `现在几点了？`
- `帮我计算 (18.5 + 7.2) * 3`
- `记住一条笔记：标题是 Agent 学习目标，内容是先学会工具调用和状态管理`
- `帮我回忆一下和 Agent 学习有关的笔记`

然后观察 UI 里出现的 tool call 卡片:

- 输入参数是什么
- 工具返回了什么
- 最终回复怎样利用这些结果

如果你要切换供应商或模型:

- 打开 `/settings`
- 输入 OpenAI 兼容的 `base URL`
- 输入 `API Key`
- 等待页面自动调用 `/models` 拉回模型列表
- 选择模型并保存

## 当前限制

- 还没有用户系统
- 还没有 RAG、联网搜索、文件上传
- 还没有测试
- 设置当前保存在浏览器本地，不适合多用户共享

这些都属于下一阶段。

## 下一阶段建议

### Stage 3: Observability

- 记录每一步耗时
- 记录 step finish 事件
- 在页面里展示完整 Agent timeline

### Stage 4: More Tools

- `web_search`
- `read_url`
- `todo_manager`

### Stage 5: Better Agent Design

- 加 tool 选择约束
- 加最大步数和异常处理
- 加 memory 总结与压缩

## 你应该重点理解什么

这个项目里最值得学的不是某个库，而是这 5 个概念:

- Prompt
- State
- Tools
- Loop
- Observability

如果你把这 5 个概念吃透，再迁移到 LangGraph、AutoGen、Mastra 或其他 Agent 框架都会快很多。
