# CHANGELOG

本文件用于记录已完成功能、已落地优化和重要文档整理，不再把这些内容放进 `TODO.md`。

## 2026-04-22

### 代码改进
- 修复会话详情页移动端滚动不跟手的问题：将顶部栏下滑隐藏的动画从 `grid-template-rows` 布局过渡改为绝对定位 + `transform: translateY` 合成层位移，避免滚动过程中滚动容器尺寸逐帧变化打断原生惯性滚动

## 2026-04-15

### Agent 体验
- 将 `/api/chat` 的 Agent 步数上限从 5 步放宽到 12 步，并将 route handler `maxDuration` 从 30 秒提升到 60 秒
- 优化 Agent 达到工具/步骤上限时的收尾体验：不再直接断流，而是在同一条助手消息里补充明确的限制说明后再结束

### 文档整理
- 将 `TODO.md` 收敛为仅保留真实未完成事项
- 新增 `CHANGELOG.md` 承接历史完成记录与代码改进
- 同步更新文档维护约定，要求完成项写入 `CHANGELOG.md`

### 代码改进
- 优化左上角模块切换器的点击外部自动收起交互
- 调整左上角模块切换器的紧凑度与下拉 hover 间距
- 调整左上角模块切换器的模块顺序与英文名称
- 修复未登录时 `manifest.webmanifest` 被认证代理重写为 HTML 的问题
- 重做 TODO 页 UI，包含右侧默认留白、标题层级强化、Markdown 等宽正文、分段式状态选择，以及左侧仅标题清单和 `! / !!` 优先级标记
- 修复全局表单字体重置覆盖组件字号和字重的问题

## 2026-04-13

### 代码改进
- 支持 Markdown 表格与 LaTeX 公式渲染
- 新增 Tavily 用量查询接口与设置页可视化
- 工具调用卡片默认折叠，审批中自动展开
- 支持左上角 `Agent Chat Lab` 标题跳转首页
- 修复会话详情中点击 `NEW CHAT` 后被旧会话加载竞态拉回的问题

## 2026-04-10

### 代码改进
- 调整新会话创建时机，`New Chat` 不再预生成前端会话 ID
- 改为首次发送消息时由服务端创建会话并返回正式 ID

## 2026-04-09

### 代码改进
- 修复会话持久化覆盖自定义标题问题
- 新增手动触发会话标题生成 API，并纳入首条助手回复上下文
- 优化首页会话列表悬浮菜单与标题打字机替换效果
- 修复首屏时间文本因时区差异导致的 React hydration 报错
- 修复 Bash Tool 在 Docker 容器内因硬编码宿主机工作目录导致的 `spawn ENOENT`
- 将 Docker 镜像改为单阶段 `node:24`，并预装 Bash Tool 常用系统命令
- 修复 Docker 容器在 `output: standalone` 下仍使用 `next start` 启动的告警
- 修复 Docker standalone 启动时未携带 `.next/static` 与 `public` 导致前端资源 404
- 为 Docker 运行镜像补充 `ethtool`，支持 Bash Tool 查询网卡能力
- 修复左侧会话列表在切换不同会话时因重置加载态导致的闪烁

## 2026-04-08

### 代码改进
- 修复 `chat-message.tsx` 类型守卫安全问题
- 合并 `provider-config.ts` 重复的 normalize 逻辑
- 修复 `chat-shell.tsx` storage 事件监听范围过大问题
- 改进 `tools.ts` 错误处理并提取魔法数字为常量
- 统一 API Route 错误信息为英文
- 修复 `provider-settings-form.tsx` debounce 闭包问题

## 历史已实现功能

### 基础应用
- 初始化 Next.js 16 + TypeScript + Tailwind CSS 4 项目
- 搭建聊天首页和基础消息 UI
- 实现 `/api/chat` Route Handler
- 接入基于 `streamText` 的最小 Agent loop
- 支持工具调用的前端可视化
- 新增静态密码登录页 `/login` 与 `/api/auth`
- 新增应用图标与 PWA 图标接口 `/api/icon`
- 新增左上角模块切换器（Chat / 系统设置 / TODO）

### 内置 Tools
- `calculator`
- `create_note`
- `search_notes`
- `WebSearch`
- `WebFetch`
- `TodoWrite`
- `TodoRead`
- `Bash`（强制人工审批 + 风险拦截）

### 模型配置
- 新增系统设置页 `/settings`
- 支持配置 OpenAI 兼容接口的 `base URL / API Key / model`
- 新增 `/api/models` 代理接口
- 通过 `/models` 自动拉取模型列表并选择
- 聊天请求支持按当前配置动态选择供应商和模型
- 将系统设置从浏览器本地存储升级为服务端持久化（SQLite）
- 支持多供应商配置（增删、启用/禁用、设为默认）
- 支持每个供应商配置多个模型（API 拉取 + 手动添加、启用/禁用、设为默认）
- 设置页支持查看 Tavily 用量概览

### Persistence
- 引入 SQLite
- 引入 Drizzle ORM
- 持久化 `conversation`
- 持久化 `message`
- 持久化 `tool_call`
- 持久化 `note`
- 新增 TODO 管理页 `/todos` 与 `/api/todos`，复用数据库 `todos` 表
- TODO 管理页改为紧凑清单 + CodeMirror 6 Markdown 详情编辑器
- 支持多会话管理（列表/创建/删除/重命名）
- 会话列表支持最近 20 条渐进展示与标题搜索
- 会话页面支持异常中断恢复与上一轮回复重生成
- 会话列表支持更多菜单、手动重命名与标题重新生成
- 新增会话标题生成接口 `/api/conversations/[id]/title`

### Observability
- 记录每一步耗时
- 记录 step finish 事件
- 在页面展示完整 Agent timeline
- 在会话详情状态区展示当前总上下文长度

### 安全基础
- 基础认证（静态密码 + 全屏遮罩登录 + Proxy API 保护）

### Chat UI
- 对话中工具调用默认折叠，也允许展开（审批中自动展开）
- Markdown 渲染增强（表格、LaTeX 公式）
- 移动端响应式适配（基础版：viewport 配置、侧边栏抽屉、统计信息折叠、dvh 高度、安全区域）
- PWA 基础支持（manifest、apple-touch-icon、动态应用图标、standalone 模式、触控优化）

## 维护规则
- 新功能完成、任务关闭或重要改进落地后，在本文件记录结果。
- `TODO.md` 只保留未完成事项，不再记录已完成内容。
- 提交 PR 前，确认 `CHANGELOG.md` 与当前代码状态一致。
