# Agent Chat Lab

一个用于学习 Agent 构建流程的 Next.js Web 应用，包含聊天、工具调用和基础记忆。

- **Chat UI**：流式回复、工具调用卡片、Agent timeline、token 统计
- **内置工具**：计算器、笔记、TODO、Tavily 搜索/抓取、受审批保护的 Bash
- **模型配置**：支持多供应商（OpenAI 兼容 / Anthropic）、模型列表拉取、settings 页面管理
- **MCP**：支持配置远程 Streamable HTTP MCP Server
- **持久化**：SQLite + Drizzle 保存会话、消息、笔记、TODO 和设置
- **安全**：静态密码登录，proxy 层统一保护

## 快速开始

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

环境变量至少需要配置 `AUTH_PASSWORD`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`（可选见 `.env.example`）。

## Docker

```bash
cp .env.example .env
docker compose up -d
```

## 入口

| 路径 | 功能 |
|------|------|
| `/` | 聊天 |
| `/todos` | TODO 管理 |
| `/settings` | 供应商 / Tavily / MCP 配置 |
| `/login` | 登录 |

## 项目结构

```
app/           页面和 API routes
components/    UI 组件
lib/ai/        模型、工具、MCP、系统提示词
lib/db/        Drizzle schema 与 SQLite
drizzle/       数据库迁移
data/          运行时 SQLite 数据
workspace/     Docker Bash 工作目录
```

## 验证

```bash
pnpm lint
pnpm build
```
