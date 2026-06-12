import type { UsageOverview } from "@/lib/persistence";
import { formatCompactTokens, formatTokenCount } from "@/lib/format";

type StatsOverviewCardsProps = {
  overview: UsageOverview;
};

type Card = {
  label: string;
  value: string;
  hint: string;
};

export function StatsOverviewCards({ overview }: StatsOverviewCardsProps) {
  const cards: Card[] = [
    {
      label: "总会话数",
      value: formatTokenCount(overview.totalConversations),
      hint: "历史全部会话",
    },
    {
      label: "总大模型调用次数",
      value: formatTokenCount(overview.totalSteps),
      hint: "Agent 循环中的模型请求数",
    },
    {
      label: "总 Tokens",
      value: formatCompactTokens(overview.totalTokens),
      hint: `输入 ${formatCompactTokens(overview.inputTokens)} · 输出 ${formatCompactTokens(overview.outputTokens)}`,
    },
    {
      label: "总工具调用",
      value: formatTokenCount(overview.totalToolCalls),
      hint: "Agent 循环内的工具调用",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-[14px] border border-[rgba(23,23,23,0.08)] bg-[rgba(248,242,235,0.8)] px-4 py-3.5"
        >
          <p className="text-[11px] uppercase tracking-[0.15em] text-[#8e8070]">
            {card.label}
          </p>
          <p className="mt-1.5 font-mono text-[22px] font-medium leading-none tracking-[-0.02em] text-[#241c15]">
            {card.value}
          </p>
          <p className="mt-2 truncate text-xs text-[#9a8d7d]" title={card.hint}>
            {card.hint}
          </p>
        </div>
      ))}
    </div>
  );
}
