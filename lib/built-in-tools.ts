export const builtInTools = [
  {
    name: "get_current_time",
    description: "读取当前时间，演示 Agent 如何访问运行时环境。",
  },
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
] as const;
