import type { ModelUsage } from "@/lib/persistence";
import { formatCacheHitRate, formatCompactTokens, formatDurationMs } from "@/lib/format";

type StatsModelTableProps = {
  models: ModelUsage[];
};

export function StatsModelTable({ models }: StatsModelTableProps) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-[rgba(23,23,23,0.08)] bg-[rgba(248,242,235,0.8)]">
      <div className="border-b border-[rgba(23,23,23,0.08)] px-4 py-3">
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-[#8e8070]">
          模型用量明细
        </h2>
      </div>

      {models.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[#9a8d7d]">暂无模型用量数据。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-[#a0937f]">
                <th className="px-4 py-2 font-medium">模型 / 供应商</th>
                <th className="px-3 py-2 text-right font-medium">调用</th>
                <th className="px-3 py-2 text-right font-medium">输入</th>
                <th className="px-3 py-2 text-right font-medium">输出</th>
                <th className="px-3 py-2 text-right font-medium">命中率</th>
                <th className="px-3 py-2 text-right font-medium">平均延迟</th>
                <th className="px-4 py-2 text-right font-medium">平均速度</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => {
                const hitRate =
                  model.inputTokens > 0
                    ? model.cachedInputTokens / model.inputTokens
                    : null;
                const speed =
                  model.totalDurationMs > 0
                    ? model.outputTokens / (model.totalDurationMs / 1000)
                    : null;

                return (
                  <tr
                    key={`${model.provider}/${model.modelId}`}
                    className="border-t border-[rgba(23,23,23,0.06)]"
                  >
                    <td className="px-4 py-2.5">
                      <span className="block font-mono text-[12px] text-[#352d25]">
                        {model.modelId}
                      </span>
                      <span className="block font-mono text-[11px] text-[#a0937f]">
                        {model.provider}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#53483d]">
                      {model.steps}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#53483d]">
                      {formatCompactTokens(model.inputTokens)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#53483d]">
                      {formatCompactTokens(model.outputTokens)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#9c5626]">
                      {formatCacheHitRate(hitRate)}
                      {hitRate === null ? "" : "%"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#53483d]">
                      {formatDurationMs(model.avgDurationMs)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[#53483d]">
                      {speed === null ? "—" : `${speed.toFixed(1)} t/s`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
