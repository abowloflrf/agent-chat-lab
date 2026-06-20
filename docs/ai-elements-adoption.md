# AI Elements 组件采用调研

> 用途：盘点 Vercel AI SDK 生态（AI Elements）中**尚未替代**的 UI 组件，以及当前没有、但 AI Elements 能带来的**新功能**，作为后续逐步调研"能否替换 / 是否引入"的清单。

## 背景与现状

- **逻辑/数据/传输层**已全量、地道地使用 AI SDK（`useChat` / `DefaultChatTransport` / `streamText` / `createUIMessageStream` / `tool()` / `createMCPClient` / `generateText`），**无可替代的自研轮子**。
- **UI 层**为全自研。Vercel 的现成 UI 库是 **AI Elements**。
- 已落地的替换：
  - **独立库、不绑 shadcn**（真实功能升级）：
    - Markdown / 代码渲染栈 → **Streamdown**（`@streamdown/code` `@streamdown/math` `@streamdown/cjk` `@streamdown/mermaid`），等价于 AI Elements 的 `Response` / `CodeBlock`，并自带表格 + Mermaid 控件。
    - 聊天自动贴底 → **use-stick-to-bottom**，即 AI Elements `Conversation` 的内核。
  - **引入 shadcn/Radix 生态**（首个真正落地的 AI Elements 组件）：
    - 推理卡 → AI Elements **`Reasoning` / `ReasoningTrigger` / `ReasoningContent`**，按官方源码手动 vendor 到 `components/ai-elements/`（含 shadcn 风格 `Collapsible`、`cn`、`Shimmer`）。换来思考耗时（"Thought for N seconds"）与正文 markdown 渲染；代价是引入 `@radix-ui/react-collapsible`、`lucide-react`、`tw-animate-css`、`motion`（官方 `Shimmer` 用）。未跑 shadcn init（无 `components.json`）。

## 关键约束：AI Elements 绑定 shadcn/ui

- AI Elements 建立在 **shadcn/ui** 之上，依赖 `radix-ui` / `class-variance-authority` / `clsx` / `tailwind-merge`，安装命令 `npx ai-elements@latest add <component>` 在未配置时会**自动初始化 shadcn/ui**。
- 本项目**未跑 shadcn init**（无 `components.json`），但为落地 `Reasoning` 已手动 vendor 了 shadcn 风格的 `Collapsible`（`components/ui/collapsible.tsx`）+ `cn`（`lib/utils.ts`）+ Radix（`@radix-ui/react-collapsible`）+ `tw-animate-css`。整体仍是 Tailwind v4 + 棕色双主题。
- 但因 Streamdown 集成，`app/globals.css` 已补了一部分 shadcn 设计 token（`--color-background/foreground/border/sidebar/muted/muted-foreground/primary`，调成暖棕色调），这降低了**单个** AI Elements 组件落地的门槛——但仍需引入 radix/cva 等运行时依赖。
- **优先判断**：采用某个 AI Elements 组件前，先看它背后是否有**独立库**可直接用（如 Streamdown、use-stick-to-bottom），能绕开 shadcn 则优先；否则按"引入 shadcn 生态"评估成本。

---

## A. 已替代（参考）

| AI Elements | 本项目实现 | 替代方式 |
|---|---|---|
| `Response` / `CodeBlock` | Markdown 渲染栈（`components/chat-message.tsx`） | ✅ Streamdown（原生默认样式） |
| `Conversation`（贴底内核） | 自研滚动状态机 | ✅ use-stick-to-bottom |
| `Reasoning` | `components/ai-elements/reasoning.tsx`（接入 `chat-message.tsx`） | ✅ AI Elements 官方版手动 vendor（含 `Collapsible` / `Shimmer`，新增耗时显示 + 正文 markdown） |
| 表格 / Mermaid 控件 | — | ✅ 随 Streamdown 开启 |

---

## B. 尚未替代的候选（有 AI Elements 对应组件）

> 这些都**绑 shadcn/ui**，且自研版**功能更强**。当前结论是**暂不替换**，但记录在此供后续重估（尤其若将来整体迁往 shadcn 体系）。每项列出"必须保住的功能"，作为评估 AI Elements 能否平替的标尺。

| AI Elements | 本项目实现 | 必须保住的功能 | 成本/风险 | 当前结论 |
|---|---|---|---|---|
| `Tool` | `components/tool-call-card.tsx`（+ `ask-user-question-card.tsx`、`todo-tool-card.tsx`） | 状态机（running/success/error/waiting）、相邻调用分组折叠、**Bash 审批流**、**Todo 面板**、**AskUserQuestion 交互表单**、原始 JSON 折叠、WebSearch/WebFetch/Bash 专项展示 | 高（远超 AI Elements 工具卡） | 暂不换，功能差距大 |
| `PromptInput` | `components/chat-composer.tsx`（+ `model-selector.tsx`、`session-tool-selector.tsx`） | textarea 自动高度、Enter/Shift+Enter、模型选择器、MCP/Skills 多选、发送/停止按钮与忙碌动画 | 中-高（shadcn） | 暂不换 |
| `Message` / `Conversation` | `components/chat-message.tsx`、`chat-message-list.tsx`、`chat-shell.tsx` | 棕色双主题（user 棕底 / assistant 白底）、消息操作、可观测指标、时间戳、布局 | 高（要重做主题） | 暂不换 |
| `Task` | `components/agent-timeline.tsx` | 每步 token / 耗时 / TTFT、折叠展开的执行时间线 | 中（shadcn） | 暂不换，自研含可观测数据 |
| `Suggestion` | Quick Start 卡（`components/chat-message-list.tsx` 的 `starterPrompts`） | 启动卡点击发送 | 低 | **低风险，可先试水** |
| `Actions` | 复制 / 重新生成按钮（`components/chat-message.tsx`） | hover 显隐、复制原文、从该条重生成 | 低 | **低风险，可先试水** |
| `Loader` | composer 忙碌指示（`components/chat-composer.tsx`） | 脉冲环 + 呼吸方块动画 | 低 | **低风险，可先试水** |

无对应 AI Elements 组件、保持自研：`AskUserQuestion`（`components/ask-user-question-card.tsx`，交互式提问表单）、artifact 弹层（`components/artifact-popover.tsx`）、会话侧边栏、设置/统计页。

---

## C. 当前没有的功能（AI Elements 能带来的新组件）

> 这些不是"自研轮子"，而是本项目尚未具备的功能。可作为**引入新组件 = 新功能**的候选评估。

| AI Elements | 它提供什么 | 对本项目的潜在价值 |
|---|---|---|
| `Branch` | 同一轮回复的多版本分支：在 regenerate 的多个结果间切换浏览 | 把现有"重新生成（覆盖）"升级为"保留多版本并切换" |
| `Source` / `InlineCitation` | 把来源以行内引用 / 来源列表展示 | 现在 WebSearch/WebFetch 结果只在工具卡里；可在正文里做带引用角标的来源展示 |
| `WebPreview` | 内嵌实时网页预览（iframe 式） | 与现有 artifacts（workspace 文件）不同，是"预览一个 URL"；可用于 WebFetch / 生成的网页 |
| `Image` | AI 生成图片的展示卡 | 仅当将来接入图像生成模型时有意义 |

---

## D. 建议的调研顺序

1. ~~低风险试水~~ **已验证**：`Reasoning` 落地证明在 Tailwind v4 + 无 shadcn 项目里，**手动 vendor 官方源码**（自建 `cn` / `Collapsible`，按需补依赖）即可，**不必跑** `npx ai-elements add` 触发 shadcn init；棕色主题靠 `globals.css` 已有的 shadcn token（`muted-foreground`/`foreground`/`background`）自动适配。后续组件沿用此路径；只需注意官方源码与本项目更严的 `react-hooks` 规则、新版 Streamdown 类型可能有小冲突（用定向 disable / 类型收窄处理）。
2. **新功能优先于重写**：`Source`/`InlineCitation`（给 WebSearch 配引用）和 `Branch`（多版本回复）是**净增价值**，比重写已有的 Tool/Message 更值得做。
3. **大件最后**：`Tool` / `Message` / `PromptInput` 自研版功能强、风险高，仅在确定整体迁往 shadcn 体系时再评估。
4. 每项调研前先查是否有**独立库**（参考 Streamdown / use-stick-to-bottom 的路径），能绕开 shadcn 的优先。

## 参考

- 安装：`npx ai-elements@latest add <component>`，或 `npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/all.json`
- AI Elements 全量组件：`actions` `branch` `code-block` `conversation` `image` `inline-citation` `loader` `message` `prompt-form` `prompt-input` `reasoning` `response` `source` `suggestion` `task` `tool` `web-preview`
- 文档：<https://ai-sdk.dev/elements>
