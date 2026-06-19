# TODO

## 当前待办

### P0 稳定性 / 正确性
- [ ] 为 Bash 中的解释器命令（`python`、`node` 等）增加额外隔离（不仅人工审批，还要限制执行环境）
- [ ] MCP 工具名按服务器名前缀隔离，避免跨服务器同名工具互相覆盖
- [ ] 为 MCP 工具执行增加超时控制（当前仅连接与工具发现有超时）
- [ ] 改进 `/api/models` 失败提示，按鉴权 / URL / 上游错误给出更可操作的报错

### P1 测试补齐
- [ ] 为 DB 持久层补单测（`persistence` / `settings` 读写路径 / `artifacts`，需 in-memory SQLite 夹具）

### P1 Agent 能力补齐
- [ ] Resumable Streaming：关闭页面后 Agent 继续运行，重新打开自动重连（设计方案见 [docs/resumable-streaming-plan.md](docs/resumable-streaming-plan.md)）
- [ ] 将 system prompt 主体改为英文，并持续参考 Codex / OpenCode / Claude Code 的 prompt 迭代工具使用策略、约束和长期任务处理规则
- [ ] 新建对话时支持首条消息配置“纯对话模式”：关闭后续整个会话的 tool 调用，默认关闭该选项
- [ ] 将 Bash 从“单条非交互命令”扩展为支持管道、重定向、多命令串联
- [ ] 文件上传与分析（图片、PDF、代码文件等多模态输入）
- [ ] 设计并实现跨会话 memory 系统：沉淀用户偏好、长期上下文和历史决策，并调研 file-based 与 SQLite 两种实现路径
- [ ] 支持在 web 设置页创建 / 编辑 / 删除 Skill（当前仅支持检索文件系统中的 Skill 并逐个开关，安装需在服务器操作）

### P1 MCP 能力补齐
- [ ] MCP 支持 `stdio` transport（当前仅 Streamable HTTP）
- [ ] MCP 支持 `SSE` transport（当前仅 Streamable HTTP）
- [ ] MCP Server 支持工具级启用开关（当前仅 server 级开关）
- [ ] 为 MCP 工具增加调用审批开关（对齐内置 Bash 的 `needsApproval` 机制）
- [ ] MCP 连接复用/缓存（当前每次请求重新握手并拉取工具列表，拖慢首 token）
- [ ] MCP 连接失败/耗时在 UI 上可观测（连接发生在 `streamText` 之前，不进 timeline，用户无法归因首字慢与失败）

### P2 体验与可观测性
- [ ] 支持指定删除某条消息
- [ ] 允许编辑用户已发送的某条消息，并基于编辑后的内容重新发送
- [ ] 完善 artifacts 误收录预防策略（忽略规则、输出目录约束、扫描开关等）
- [ ] Markdown 渲染增强（Mermaid 图表）
- [ ] 会话详情顶部状态栏支持跨 Safari / Chrome 一致的轻量毛玻璃效果，且无明显分层横条

### P2 架构与产品扩展
- [ ] 为模型供应商增加“本地调用”模式（V1）：浏览器直连 provider 发起纯聊天请求，暂不支持 tool call、approval、timeline 和服务端 Agent loop
- [ ] 支持按用户隔离 system settings、conversations、notes、todos
- [ ] chat-shell 逻辑层 hook 化（重构阶段 4，可选）：将流恢复、路由竞态守卫、会话配置对账等抽成自定义 hook；高风险，需先补对应竞态回归测试兜底（测试框架已就绪）
- [ ] DeepSeek 思考模式工具调用回传 `reasoning_content`（可选，规范对齐）：`@ai-sdk/openai` chat 路径会丢弃 reasoning，需用自定义 fetch 拦截出站 body、观测响应流补回字段，并按模型名 gate。实测 v4-flash 当前省略不报 400，故暂不做；触发条件：出现 `reasoning_content must be passed back` 的 400，或上 v4-pro 跑深串行 agent 后察觉工具调用后推理质量下降。须做就做完整版（覆盖单轮内多步循环，仅补跨轮历史无意义）。

## 维护规则
- 新任务、范围变更、优先级调整时，只在本文件维护未完成事项。
- 任务完成后，从本文件移除，并将结果记录到 `CHANGELOG.md`。
- 提交 PR 前，确认 `TODO.md` 与 `CHANGELOG.md` 都与当前代码状态一致。
