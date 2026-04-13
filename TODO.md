# TODO

## 已实现

### 基础应用
- [x] 初始化 Next.js 16 + TypeScript + Tailwind CSS 4 项目
- [x] 搭建聊天首页和基础消息 UI
- [x] 实现 `/api/chat` Route Handler
- [x] 接入基于 `streamText` 的最小 Agent loop
- [x] 支持工具调用的前端可视化
- [x] 新增静态密码登录页 `/login` 与 `/api/auth`
- [x] 新增应用图标与 PWA 图标接口 `/api/icon`

### 内置 Tools
- [x] `calculator`
- [x] `create_note`
- [x] `search_notes`
- [x] `WebSearch`
- [x] `WebFetch`
- [x] `TodoWrite`
- [x] `TodoRead`
- [x] `Bash`（强制人工审批 + 风险拦截）

### 模型配置
- [x] 新增系统设置页 `/settings`
- [x] 支持配置 OpenAI 兼容接口的 `base URL / API Key / model`
- [x] 新增 `/api/models` 代理接口
- [x] 通过 `/models` 自动拉取模型列表并选择
- [x] 聊天请求支持按当前配置动态选择供应商和模型
- [x] 将系统设置从浏览器本地存储升级为服务端持久化（SQLite）
- [x] 支持多供应商配置（增删、启用/禁用、设为默认）
- [x] 支持每个供应商配置多个模型（API 拉取 + 手动添加、启用/禁用、设为默认）
- [x] 设置页支持查看 Tavily 用量概览

### Persistence
- [x] 引入 SQLite
- [x] 引入 Drizzle ORM
- [x] 持久化 `conversation`
- [x] 持久化 `message`
- [x] 持久化 `tool_call`
- [x] 持久化 `note`
- [x] 支持多会话管理（列表/创建/删除/重命名）
- [x] 会话列表支持最近 20 条渐进展示与标题搜索
- [x] 会话页面支持异常中断恢复与上一轮回复重生成
- [x] 会话列表支持更多菜单、手动重命名与标题重新生成
- [x] 新增会话标题生成接口 `/api/conversations/[id]/title`

### Observability
- [x] 记录每一步耗时
- [x] 记录 step finish 事件
- [x] 在页面展示完整 Agent timeline
- [x] 在会话详情状态区展示当前总上下文长度
- [ ] 用量统计仪表盘（设计方案见 [docs/usage-stats-dashboard-design.md](docs/usage-stats-dashboard-design.md)）

### 工程化
- [x] 更新 `README.md`
- [x] 生成项目级 `AGENTS.md`
- [x] 当前代码可通过 `pnpm lint`
- [x] 当前代码可通过 `pnpm build`

## 未完成

### 安全基础
- [x] 基础认证（静态密码 + 全屏遮罩登录 + Proxy API 保护）

### 核心能力扩展
- [ ] 文件上传与分析（图片、PDF、代码文件等多模态输入）
- [ ] 将 Bash 从”单条非交互命令”扩展为支持管道、重定向、多命令串联
- [ ] 为 Bash 增加解释器脚本执行能力（如 `python`、`node` 等）并补充隔离与限制
- [ ] 将 Bash 风险策略从”高风险硬拦截”升级为”高风险默认警告，但允许用户人工放行”
- [ ] 跨会话记忆（记住用户偏好、常用上下文、历史决策，支持自动摘要）

### Chat UI
- [ ] 回复消息的代码块支持语法高亮
- [ ] 支持指定删除某条消息
- [ ] 允许编辑用户已发送的某条消息，并基于编辑后的内容重新发送
- [x] 对话中工具调用默认折叠，也允许展开（审批中自动展开）
- [x] Markdown 渲染增强（表格、LaTeX 公式）
- [ ] Markdown 渲染增强（Mermaid 图表）
- [ ] 会话详情顶部状态栏支持跨 Safari / Chrome 一致的轻量毛玻璃效果，且无明显分层横条
- [x] 移动端响应式适配（基础版：viewport 配置、侧边栏抽屉、统计信息折叠、dvh 高度、安全区域）
- [x] PWA 基础支持（manifest、apple-touch-icon、动态应用图标、standalone 模式、触控优化）
- [ ] PWA 体验深度优化（启动画面、图标精修、过渡动画、页面切换手势等）

### Better Agent Design
- [ ] Resumable Streaming：关闭页面后 Agent 继续运行，重新打开自动重连（设计方案见 [docs/resumable-streaming-plan.md](docs/resumable-streaming-plan.md)）
- [ ] 增加 tool 选择约束
- [ ] 优化 system prompt（参考 opencode 源码）
- [ ] 新建对话时支持首条消息配置“纯对话模式”：关闭后续整个会话的 tool 调用，默认关闭该选项
- [ ] 放宽 Agent 步数上限（当前 5 步）和超时时间（当前 30 秒）
- [ ] 优化 Agent 在达到工具/步骤上限时的收尾体验：不要直接结束流，至少输出一段明确的最终文字结论或限制说明
- [ ] 完善异常处理
- [ ] 为高风险工具补充更细粒度的风险规则与测试
- [ ] MCP (Model Context Protocol) 支持，通过标准协议接入外部工具和服务
- [ ] 文件生成与下载（代码、报告、数据等）

### System Settings
- [ ] 增加”测试连接”按钮
- [ ] 优化模型拉取失败时的错误提示与重试
- [ ] 为模型供应商增加“本地调用”模式（V1）：浏览器直连 provider 发起纯聊天请求，暂不支持 tool call、approval、timeline 和服务端 Agent loop
- [ ] 支持多用户配置隔离

### Testing
- [ ] 引入测试框架
- [ ] 为 `lib/ai/tools.ts` 添加单元测试
- [ ] 为 `/api/chat` 添加集成测试
- [ ] 为 `/api/models` 添加集成测试

### Product Gaps
- [ ] 用户系统
- [ ] RAG / 知识检索
- [ ] 文件上传

## 代码改进 (2026-04-08)

- [x] 修复 chat-message.tsx 类型守卫安全问题
- [x] 合并 provider-config.ts 重复的 normalize 逻辑
- [x] 修复 chat-shell.tsx storage 事件监听范围过大问题
- [x] 改进 tools.ts 错误处理并提取魔法数字为常量
- [x] 统一 API Route 错误信息为英文
- [x] 修复 provider-settings-form.tsx debounce 闭包问题

## 代码改进 (2026-04-09)

- [x] 修复会话持久化覆盖自定义标题问题
- [x] 新增手动触发会话标题生成 API，并纳入首条助手回复上下文
- [x] 优化首页会话列表悬浮菜单与标题打字机替换效果
- [x] 修复首屏时间文本因时区差异导致的 React hydration 报错
- [x] 修复 Bash Tool 在 Docker 容器内因硬编码宿主机工作目录导致的 `spawn ENOENT`
- [x] 将 Docker 镜像改为单阶段 `node:24`，并预装 Bash Tool 常用系统命令
- [x] 修复 Docker 容器在 `output: standalone` 下仍使用 `next start` 启动的告警
- [x] 修复 Docker standalone 启动时未携带 `.next/static` 与 `public` 导致前端资源 404
- [x] 为 Docker 运行镜像补充 `ethtool`，支持 Bash Tool 查询网卡能力
- [x] 修复左侧会话列表在切换不同会话时因重置加载态导致的闪烁

## 代码改进 (2026-04-10)

- [x] 调整新会话创建时机，`New Chat` 不再预生成前端会话 ID
- [x] 改为首次发送消息时由服务端创建会话并返回正式 ID

## 代码改进 (2026-04-13)

- [x] 支持 Markdown 表格与 LaTeX 公式渲染
- [x] 新增 Tavily 用量查询接口与设置页可视化
- [x] 工具调用卡片默认折叠，审批中自动展开
- [x] 支持左上角 `Agent Chat Lab` 标题跳转首页
- [x] 修复会话详情中点击 `NEW CHAT` 后被旧会话加载竞态拉回的问题

## 维护规则
- 每次新增功能、完成任务或调整范围时，同步更新本文件。
- 新任务先写到"未完成"，完成后移动到"已实现"。
- 提交 PR 前，确认 `TODO.md` 与当前代码状态一致。
