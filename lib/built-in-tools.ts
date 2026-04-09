export const builtInTools = [
  {
    name: "calculator",
    description: "执行受限数学表达式计算，演示确定性工具。",
  },
  {
    name: "create_note",
    description: "写入一条持久化笔记，演示 Agent 修改状态。",
  },
  {
    name: "search_notes",
    description: "检索已有持久化笔记，演示最小记忆能力。",
  },
  {
    name: "TodoWrite",
    description: "创建、更新、完成、恢复或删除待办事项，演示任务状态管理。",
  },
  {
    name: "TodoRead",
    description: "读取待办事项列表，支持按状态或关键词筛选。",
  },
  {
    name: "Bash",
    description: "执行受审批与风险判定约束的单条非交互命令。每次调用都必须先由用户明确允许。",
  },
  {
    name: "WebSearch",
    description: "使用 Tavily 联网搜索最新网页信息，适合处理时效性或外部事实查询。",
  },
  {
    name: "WebFetch",
    description: "使用 Tavily 抓取指定 URL 的网页正文，适合在搜索后继续读取原文内容。",
  },
] as const;
