# Agent Chat Lab

一个用于学习 Agent 构建流程的 Next.js Web 应用。它聚焦一条最小但完整的主链路：

1. 用户输入消息
2. 服务端拼接系统提示词与历史消息
3. 模型决定是否调用工具
4. 工具执行并返回结果
5. 模型基于工具结果产出最终回复

## 核心能力

- Chat UI：流式回复、工具调用卡片、Agent timeline、上下文与 token 统计
- 内置工具：计算器、笔记、TODO、Tavily 搜索/抓取、受审批保护的 Bash
- 模型配置：支持多个 OpenAI 兼容供应商、模型列表拉取、三种 provider protocol
- MCP：支持在设置页配置远程 Streamable HTTP MCP Server
- 持久化：SQLite + Drizzle 保存会话、消息、工具调用、笔记、TODO 和系统设置
- 安全：静态密码登录，页面与 API 由 `proxy.ts` 统一保护
- TODO 页面：`/todos` 可直接管理与 Agent 共用的待办数据

## 技术栈

- Next.js 16 / React 19 / TypeScript
- Tailwind CSS 4
- Vercel AI SDK 6
- SQLite + Drizzle ORM
- CodeMirror 6 / Shiki / KaTeX

## 本地运行

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

打开：

```text
http://localhost:3000
```

`.env.local` 至少需要配置：

```bash
AUTH_PASSWORD=your_login_password
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
```

可选配置：

- `TAVILY_API_KEY`：启用 `WebSearch` / `WebFetch`
- `BASH_TOOL_WORKDIR`：Bash Tool 工作目录
- `LOG_LEVEL`：日志级别，默认 `info`
- `PORT`：服务端口，默认 `3000`

模型供应商、Tavily Key 和 MCP Server 也可以在 `/settings` 页面配置；如果环境变量和系统设置同时存在，运行时优先使用系统设置。

## Docker 运行

```bash
cp .env.example .env
docker compose up -d
```

Compose 会挂载：

- `./data:/app/data`
- `./workspace:/app/workspace`

Docker 中 Bash Tool 默认使用 `/app/workspace` 作为工作目录。

## 常用入口

- `/`：聊天
- `/todos`：TODO 管理
- `/settings`：模型供应商、Tavily、MCP 配置
- `/login`：登录

## 项目结构

```text
app/            # 页面和 API routes
components/     # UI 组件
lib/ai/         # 模型、工具、MCP、系统提示词
lib/db/         # Drizzle schema 与 SQLite 初始化
lib/            # 持久化、设置、可观测性等共享逻辑
drizzle/        # 数据库迁移
data/           # 运行时 SQLite 数据
workspace/      # Docker Bash Tool 工作区挂载目录
```

## 验证

提交前至少运行：

```bash
pnpm lint
pnpm build
```

## 当前限制

- 还没有多用户系统或用户级数据隔离
- 还没有 RAG、文件上传
- 还没有测试框架
- MCP 当前仅支持 Streamable HTTP transport
- Bash 当前仅支持单条非交互命令
