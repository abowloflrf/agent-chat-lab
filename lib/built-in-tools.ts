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
    name: "read",
    description: "读取文本文件内容，支持 offset/limit 分段读取大文件，返回不含行号的原始文本。",
  },
  {
    name: "write",
    description: "写入文件，不存在则新建、存在则覆盖，并自动创建父级目录。适合先写代码再用 Bash 执行。",
  },
  {
    name: "edit",
    description: "对单个文件做精确文本替换，每处 oldText 须在原文中唯一且互不重叠，可一次提交多处改动。",
  },
  {
    name: "AskUserQuestion",
    description:
      "在缺少关键信息时向用户弹出提问卡片，支持选项快选、自由输入或跳过，作答后 Agent 自动继续。",
  },
  {
    name: "WebSearch",
    description: "使用 Tavily 联网搜索最新网页信息，适合处理时效性或外部事实查询。",
  },
  {
    name: "WebFetch",
    description: "使用 Tavily 抓取一个或多个 URL 的网页正文，适合在搜索后继续读取原文内容。",
  },
  {
    name: "Skill",
    description:
      "按名字加载某个 Skill 的完整指令并据此执行；任务匹配某个已启用 Skill 的用途时自动调用。仅在检测到至少一个已启用 Skill 时提供。",
  },
] as const;
