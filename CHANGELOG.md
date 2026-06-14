# CHANGELOG

本文件用于记录已完成功能、已落地优化和重要文档整理，不再把这些内容放进 `TODO.md`。

## 2026-06-14
- 聊天界面优化：流式自动滚动、输入框与顶部状态栏改液态玻璃、Artifacts 入口精简

## 2026-06-13

- 基础镜像预装常用 Python 库（requests、pandas、openpyxl、matplotlib、Pillow、pyyaml、pypdf）
- 修复 Bash 子进程残留僵尸

### 会话 Artifact 模式
- 新增会话 Artifacts：自动记录 workspace 产物并提供会话级 API，顶部入口以紧凑弹出列表展示文件并支持当前页预览和下载

### 底部栏新增会话级 MCP / Skills 选择
- 输入栏新增 MCP、Skills 多选，且模型/MCP/Skills 选择按会话持久化

### 新增 Skill 支持

### 新增文件工具 read / write / edit
- 新增 read / write / edit 文件工具，与 Bash 共用工作目录，可先写代码文件再用 Bash 执行，避免长代码塞进 Bash 命令参数

### 输入栏一体式重构
- 聊天底部输入栏重构为一体式 composer：输入框、模型选择器与发送/停止按钮收进同一圆角容器（底部操作行左右对齐），容器 focus 时整体高亮，发送按钮改向上箭头并以浅色填充表达禁用态，模型选择器改为 ghost 样式且弹层带出现动画

## 2026-06-12

### 工具调用 UI 简化
- 工具调用改为紧凑行式渲染：相邻调用聚合成分组（历史全成功的分组默认折叠成一行），成功态去掉冗余徽章与状态条，等待审批/回答改用独立的琥珀色等待视觉（不再伪装成"运行中"），专属面板工具的原始 JSON 收进「原始数据」折叠区，执行时间线降级为消息底部一行可展开的小字摘要

### 工具调用交互修复
- 修复中断恢复链路：残留 `input-available` 的工具调用现在会被客户端/服务端双侧补成中断错误（此前会导致历史卡片永远转圈、下一次请求被模型 API 以缺少 tool result 拒绝）；审批/提问按钮增加提交中状态，等待操作期间卡片头部不再误翻折叠状态，详情模态支持 Esc 关闭与焦点管理，错误横幅新增「重试上一轮」，动画尊重 `prefers-reduced-motion`

### 用量记录供应商字段修复
- 用量记录的 `provider` 改为记录设置中的供应商名称（此前误存 AI SDK 协议标识如 `openai.chat`），用量明细与 agent 时间线随之显示真实供应商；历史数据保留旧值

### 设置页子菜单可路由
- 系统设置四个子菜单改为独立 URL（`/settings/model`、`/settings/tools`、`/settings/stats`、`/settings/conversations`），`/settings` 重定向到模型配置，支持直接深链与浏览器前进/后退

### 用量统计 + 会话管理
- 系统设置新增「用量统计」「会话管理」两个子 tab：前者含汇总卡片、按天 Token 趋势图（Recharts，支持 7/30/90 天切换）、模型用量明细与性能洞察；后者为高密度会话列表，支持标题搜索与单条/批量删除（行内两段式确认），命中率列带红→绿色阶与迷你进度条。数据由新表 `usage_records`（每 step 一行，含历史回填）聚合而来
- 会话管理新增「数据量」列，按消息存储字节估算每个会话占用大小（KB/MB）

### CI/CD
- Docker 镜像发布改为 `linux/amd64`、`linux/arm64` 原生 runner 分平台并行构建并合并 manifest，同时停止生成短 SHA 标签

### 代码块渲染修复
- 修复无语言代码块被误判为行内代码导致的深色贴字背景：`CodeBlock` 对无语言块直接按块级样式渲染，并为 Shiki 配置 `defaultLanguage: "text"` 让其走统一高亮管线

### 新增内置工具 AskUserQuestion
- 新增客户端提问工具：模型缺少关键信息时弹出提问卡片（选项快选 / 自由输入 / 跳过），作答后自动续跑 Agent；未作答直接发新消息时服务端自动补「未作答」结果，不再报错

### WebFetch 批量抓取
- WebFetch 支持一次传入多个 URL 并发抓取（此前每次只能抓一个），多页面读取/对比无需逐个调用

### PWA 图标
- 应用图标改为纯静态（`favicon.ico` / `apple-icon.png` / manifest 图标），不再运行时动态生成，消除切换会话时浏览器标签图标闪烁

## 2026-06-11

### 会话列表修复
- 修复侧栏"查看更多"按钮经常不显示的问题：按钮显隐不再依赖滚动位置（按钮插入会改变滚动高度导致显示条件自我失效），改为只要还有更多会话就常驻在列表底部

### Bash 审批策略分级
- Bash 审批改为三档：只读命令自动执行、可能修改状态的命令需人工批准、确定高危命令（`rm`/`sudo`/磁盘/电源类等）直接拒绝

### Todo 体验重做
- 重做 `/todos` 页面为「紧凑列表 + 抽屉」布局：行内直接切换状态/优先级，删除改为两步确认，保存失败常驻提示可重试；修复切换待办与并发保存时可能丢编辑的两处 bug
- TodoWrite 工具补充 `status` 字段（此前模型无法把待办设为「进行中」），TodoRead 返回值瘦身；system prompt 恢复「笔记与待办」工具指引
- 聊天页内 TodoWrite/TodoRead 结果改为专属待办卡片渲染，解析失败回落 JSON 面板

### MCP 优化
- 设置页 MCP Server 卡片新增"测试连接"：按当前填写（可未保存）的 URL/Headers 连接一次并列出可用工具，失败时显示具体原因（此前连接失败只写服务端日志，配置错误无从感知）
- 新增 `/api/mcp-test` 接口承载连接测试，复用聊天链路同款超时与连接清理逻辑
- System prompt 不再写死"只有 WebSearch/WebFetch/Bash"这一封闭能力集（接入 MCP 后该描述与实际工具矛盾）：能力边界改为"以当前实际工具集为准"，并在连接 MCP 后动态注入本轮接入的 MCP 工具清单（按来源服务器分组），让模型正确认知可用工具
- `/api/chat` 单次请求只读取一次系统设置（此前 provider 配置与 MCP 列表各读一次），并将消息持久化与 MCP 连接并行执行，缩短首 token 延迟；持久化失败时仍会关闭已建立的 MCP 连接

### MCP 修复
- 修复 MCP Server 配置可能被静默清空的问题：保存时校验 URL 必须是合法 http(s) 地址（非法时返回明确错误），读取 `mcp_servers` JSON 列时逐条解析，单条损坏记录只丢弃自身而不再导致整个列表解析失败
- 修复 MCP 连接超时后的客户端泄漏：`withTimeout` 超时后若底层连接迟到成功会主动关闭该客户端；工具发现阶段失败时也会关闭已建立的连接；超时计时器在正常完成时及时清除
- 修复客户端中断时 MCP 连接不释放：`/api/chat` 将 `request.signal` 传入 `streamText` 并新增 `onAbort` 回调，用户停止生成或断开连接时立即中止生成并关闭 MCP 连接；`close()` 改为幂等

## 2026-06-10

### CI/CD
- 新增 GitHub Actions CI, 自动构建镜像

## 2026-06-02

### Observability
- 会话顶部状态栏在"总上下文"之外新增 Session 级 token 消耗统计：总输入 tokens、总输出 tokens、缓存命中 tokens 与缓存命中率（命中 / 总输入），数据由各消息 timeline 的 `usage` 聚合得出

### 核心能力扩展
- 新增 MCP (Model Context Protocol) Server 支持：可在 `/settings` 工具页配置多个远程 MCP Server（Streamable HTTP transport），支持自定义请求 Headers 鉴权与 Server 级启用开关；启用的 Server 在每次对话请求时连接并将其工具合并进 Agent 工具集，内置工具优先级更高以避免被远程工具覆盖
- MCP 连接具备容错与超时保护：单个 Server 连接或工具发现失败会被跳过并记录日志，不阻断整轮对话；连接在生成结束或出错时统一关闭释放资源
- MCP Server 配置持久化在 `system_settings.mcp_servers`（JSON 列，迁移 `0004`），随系统设置一并读写

### 依赖维护
- 升级除 `eslint` 外的过期依赖，包含 AI SDK、`ai`、Shiki、CodeMirror、DOMPurify、KaTeX、`better-sqlite3` 与 React/Node 类型包

## 2026-04-22

### Chat UI
- 消息代码块接入 Shiki 语法高亮（`github-light` 主题、JS 正则引擎、按需预载常见语言），流式输出期间跳过高亮以避免卡顿，完成后再渲染高亮结果

### 代码改进
- 修复会话详情页移动端滚动不跟手的问题：将顶部栏下滑隐藏的动画从 `grid-template-rows` 布局过渡改为绝对定位 + `transform: translateY` 合成层位移，避免滚动过程中滚动容器尺寸逐帧变化打断原生惯性滚动
- 重构 `CodeBlock`：改为直接从 HAST node 读取原始代码文本与语言，避免 Shiki 将纯文本转为 token span 后复制/SVG 检测失效
- 修复会话标题异步生成的竞态：新会话标题生成完成后切到旧会话时，不再把新标题错误套用到当前激活的历史会话

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
