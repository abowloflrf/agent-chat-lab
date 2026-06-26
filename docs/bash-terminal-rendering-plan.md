# Bash 工具调用「终端化」展示方案

> 目标：把 Bash 类工具调用的展开视图，从「打印整个 `BashExecutionResult` JSON」改造成贴近真实终端的「命令 + 输出」呈现，让命令行调用成为一等公民。

## 背景与问题

`components/tool-call-card.tsx` 里，所有工具共用 `IOPanel`，输出内容是 `formatJson(invocation.output)`。Bash 的 output 是一个对象（`lib/ai/bash-server.ts` → `BashExecutionResult`）：

```ts
{ command, exitCode, stdout, stderr, durationMs, riskLevel, reasons, workdir, fullOutputPath? }
```

直接 `JSON.stringify` 后：

- stdout/stderr 里的换行被转义成字面 `\n`，多行输出挤成一行，几乎不可读；
- exitCode / 耗时 / workdir 等元信息和正文混在 JSON 大括号里；
- 完全没有「终端」的样子，而 Bash 调用恰恰是用户最关心、最该一眼看懂的一类。

当前展开态 Bash 区块结构：
1. 命令预览 `<pre>`（`bashAssessment.normalizedCommand`）——始终显示；
2. 风险评估卡——仅审批中 / 审批已回应时显示；
3. `IOPanel` Output（= 整个对象的 JSON）——非审批态显示；
4. 「原始数据」`<details>`（Input + Output JSON）。

## 方案

### 1. 新增 `BashToolPanel`（终端块，极简无顶栏）

仿照已有的 `TodoToolPanel` / `AskUserQuestionPanel`，在 `tool-call-card.tsx` 新增一个 Bash 专属面板组件，渲染一个深色「终端块」。采用**极简无顶栏**风格——不做装饰圆点 / workdir 顶栏，元信息收进命令行右侧：

```
$ pnpm build                       exit 0 · 1.2s   展开
─────────────────────────────────────────────────────
✓ Compiled successfully
  ...stdout / stderr 合并输出...
```

要点：
- 复用现有 token：背景 `--panel-strong`，正文 `--panel-foreground`，弱化文字 `--panel-muted`，`$` 提示符用 `--accent`。**不新增颜色变量**。
- 终端块在所有主题下都是深色（`--panel-strong` 三主题均为深色），所以退出码用**浅底小药丸**（`--success-surface`/`--danger-surface` 自带浅底，在深色卡上可读），耗时/「运行中…」用 `--panel-muted`。
- stdout、stderr **合并**为一段输出（服务端分别捕获、无时间戳，无法还原交错顺序；深色面板上再给 stderr 单独配色易踩低对比度坑）。成败由退出码药丸表达，更贴近真实终端。截断提示、超时提示已由服务端写进文本，原样显示。
- **命令行与输出区都限高、内部滚动，谁都不会撑爆卡片**：命令行 `<pre>` 用 `whitespace-pre-wrap` 自动换行 + `max-h` + `overflow-auto`（长脚本/heredoc 内部滚动）；输出 `<pre>` 用 `whitespace-pre + overflow-auto` 保留对齐（表格/TUI 友好）+ `max-h`。
- **合并一个「展开」按钮**（卡片右上 / 命令行右侧）：点开走现有 `ContentModal`，弹窗内容是完整的 `$ 命令` + 完整输出整段终端会话，一次看全命令和输出，不再分两个按钮。
- 空输出显示弱化占位 `(无输出)`。退出码：`0` 绿药丸、非 0 红药丸、`null`（被 kill/超时）红药丸「已终止」。耗时格式化为 `340ms` / `1.2s`。
- 解析失败（output 形状不符）回退为原始 JSON 文本，绝不丢数据。

### 2. 解析与状态

- 新增纯函数 `parseBashOutput(output): BashExecutionResult | null`（防御式读字段，形状不符返回 `null`，回退到现有 JSON 展示）。
- 运行中（`input-streaming` / `input-available`，无 output）：终端卡只渲染命令行 + 「运行中…」，无输出区。
- 失败（`output-error`）：终端卡命令行下渲染 `invocation.errorText`（红色），无结构化对象。

### 3. 接线（替换现有 Bash 分支）

- 把现状第 1 项「命令预览 pre」+ 第 3 项「IOPanel Output」合并为这个终端卡：命令行就是 `$ command`，下面直接是输出。
- 审批中 / 审批已回应：**保持现有风险评估卡不变**（重要 UX），命令仍以终端行样式展示。
- 第 4 项「原始数据」`<details>`（完整 Input/Output JSON）保留，供需要看原始结构的场景兜底。

### 4. 折叠态行小增强

`ToolCallRow` 折叠行已显示命令摘要。增量：Bash 调用成功/失败时在摘要与徽章之间补一个极小的退出码圆点（绿=`exit 0` / 红=非 0 或失败），让折叠态也能一眼看出命令成败。折叠行底色是浅色面板，直接用 `--success`/`--danger` 即可。

## 本期不做

- 不做 stdout/stderr 真实交错（服务端只分别捕获，无时间戳，无法还原顺序）。
- 不引入新依赖、不引入新颜色 token。
- 不改 `bash-server.ts` / `bash-policy.ts` 等服务端逻辑，纯前端展示层改造。
- 不做准实时流式输出（见 Phase 2）。但 `BashOutput` 数据形状**预留 `running` 语义**（中间态 `exitCode` 为空 → running），终端卡 running 状态先靠 `part.state`（无 output）渲染，为 Phase 2 预热。

## Phase 2（后续、本次不做）：准实时流式输出

可行性已查证：AI SDK v6（`ai@^6.0.209`）支持 **Preliminary Tool Results**——把工具 `execute` 改成 `async function*`，每 `yield` 一次中间结果就推送到前端、**整体替换**该 tool part 的 output，`useChat` 随之重渲。前端渲染 `invocation.output` 的逻辑基本不变，终端卡能渲染「进行中 + 部分输出」即可。

落地要点与坑（实现时再细化）：
- 服务端 `bash-server.ts` 由 `Promise + child.on('data'/'close')` 改写为 async generator：把事件流桥成异步迭代，stdout/stderr 到达时 yield**累积快照**（非增量），保留现有尾部截断 / 超时杀进程组 / 完整输出持久化。
- **必须节流**（约 250ms 或按字节阈值合并一帧），否则高频 data 刷爆消息流与前端重渲；快照已被 `outputLimit` 截到有界。
- 中间快照 `exitCode` 留空 + `running` 标记，前端据此区分「运行中」与「已结束」。
- 核对 chat route 持久化时机，确保**只落最终值**，中间 preliminary 快照不写进历史会话。

## 影响文件

- `components/tool-call-card.tsx`：新增 `BashToolPanel` + `parseBashOutput`，替换 Bash 展开分支；折叠行小增强。
- （可能）`app/globals.css`：仅在需要时加一条终端块的滚动/选区样式，优先纯 Tailwind。

## 验证

`pnpm lint && pnpm build`；本地跑几条命令（成功 / 非 0 退出 / 多行输出 / 超长截断 / 运行中）目测终端卡。
