# TODO

## 当前待办

### Observability
- [ ] 用量统计仪表盘（设计方案见 [docs/usage-stats-dashboard-design.md](docs/usage-stats-dashboard-design.md)）

### 核心能力扩展
- [ ] 文件上传与分析（图片、PDF、代码文件等多模态输入）
- [ ] 将 Bash 从“单条非交互命令”扩展为支持管道、重定向、多命令串联
- [ ] 为 Bash 增加解释器脚本执行能力（如 `python`、`node` 等）并补充隔离与限制
- [ ] 将 Bash 风险策略从“高风险硬拦截”升级为“高风险默认警告，但允许用户人工放行”
- [ ] 跨会话记忆（记住用户偏好、常用上下文、历史决策，支持自动摘要）

### Chat UI
- [ ] 支持指定删除某条消息
- [ ] 允许编辑用户已发送的某条消息，并基于编辑后的内容重新发送
- [ ] Markdown 渲染增强（Mermaid 图表）
- [ ] 会话详情顶部状态栏支持跨 Safari / Chrome 一致的轻量毛玻璃效果，且无明显分层横条
- [ ] PWA 体验深度优化（启动画面、图标精修、过渡动画、页面切换手势等）

### Better Agent Design
- [ ] Resumable Streaming：关闭页面后 Agent 继续运行，重新打开自动重连（设计方案见 [docs/resumable-streaming-plan.md](docs/resumable-streaming-plan.md)）
- [ ] 调研能否引入 Workflow SDK 改进 Agent 对话工作流（durable execution、人工审批恢复、长任务续跑）
- [ ] 增加 tool 选择约束
- [ ] 优化 system prompt（参考 opencode 源码）
- [ ] 新建对话时支持首条消息配置“纯对话模式”：关闭后续整个会话的 tool 调用，默认关闭该选项
- [ ] 完善异常处理
- [ ] 为高风险工具补充更细粒度的风险规则与测试
- [ ] MCP 扩展：支持 stdio / SSE transport、工具级启用开关与连接状态测试（当前仅 Streamable HTTP + server 级开关）
- [ ] MCP 工具按服务器名加前缀，消除跨服务器同名工具的覆盖顺序不确定问题
- [ ] 为 MCP 工具增加调用审批开关（对齐内置 Bash 的 `needsApproval` 机制）
- [ ] MCP 连接复用/缓存（当前每次请求重新握手并拉取工具列表，拖慢首 token）；连接失败时在 UI 上给出提示
- [ ] 为 MCP 工具执行增加超时控制（当前仅连接与工具发现有超时）
- [ ] 文件生成与下载（代码、报告、数据等）

### System Settings
- [ ] 增加“测试连接”按钮
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

## 维护规则
- 新任务、范围变更、优先级调整时，只在本文件维护未完成事项。
- 任务完成后，从本文件移除，并将结果记录到 `CHANGELOG.md`。
- 提交 PR 前，确认 `TODO.md` 与 `CHANGELOG.md` 都与当前代码状态一致。
