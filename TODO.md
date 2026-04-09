# TODO

## 已实现

### 基础应用
- [x] 初始化 Next.js 16 + TypeScript + Tailwind CSS 4 项目
- [x] 搭建聊天首页和基础消息 UI
- [x] 实现 `/api/chat` Route Handler
- [x] 接入基于 `streamText` 的最小 Agent loop
- [x] 支持工具调用的前端可视化

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

### Observability
- [x] 记录每一步耗时
- [x] 记录 step finish 事件
- [x] 在页面展示完整 Agent timeline
- [x] 在会话详情状态区展示当前总上下文长度

### 工程化
- [x] 更新 `README.md`
- [x] 生成项目级 `AGENTS.md`
- [x] 当前代码可通过 `pnpm lint`
- [x] 当前代码可通过 `pnpm build`

## 未完成

### Better Agent Design
- [ ] 增加 tool 选择约束
- [ ] 完善最大步数限制
- [ ] 完善异常处理
- [ ] 增加 memory 总结与压缩
- [ ] 为高风险工具补充更细粒度的风险规则与测试
- [ ] 将 Bash 从“单条非交互命令”扩展为支持多命令串联与更复杂的 shell 语法
- [ ] 为 Bash 增加解释器脚本执行能力（如 `python`、`node` 等）并补充隔离与限制
- [ ] 将 Bash 风险策略从“高风险硬拦截”升级为“高风险默认警告，但允许用户人工放行”

### System Settings
- [ ] 增加“测试连接”按钮
- [ ] 优化模型拉取失败时的错误提示与重试
- [ ] 将系统设置从浏览器本地存储升级为服务端持久化
- [ ] 支持多用户配置隔离

### Testing
- [ ] 引入测试框架
- [ ] 为 `lib/ai/tools.ts` 添加单元测试
- [ ] 为 `/api/chat` 添加集成测试
- [ ] 为 `/api/models` 添加集成测试

### Product Gaps
- [ ] 用户系统
- [ ] RAG / 知识检索
- [ ] 联网搜索
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

## 维护规则
- 每次新增功能、完成任务或调整范围时，同步更新本文件。
- 新任务先写到"未完成"，完成后移动到"已实现"。
- 提交 PR 前，确认 `TODO.md` 与当前代码状态一致。
