"use client";

import {
  formatCacheHitRate,
  formatCompactTokens,
  formatContextLength,
} from "@/lib/format";

function StatusMetric({
  label,
  value,
  title,
  icon,
  iconClassName,
  suffix,
  muted = false,
}: {
  label?: string;
  value: string;
  title: string;
  icon?: string;
  iconClassName?: string;
  suffix?: string;
  muted?: boolean;
}) {
  return (
    <span
      className="flex items-baseline gap-1 whitespace-nowrap"
      title={title}
    >
      <span className={muted ? "text-muted-foreground" : "text-foreground"}>
        {icon ? (
          <span className={`mr-0.5 ${iconClassName ?? ""}`}>{icon}</span>
        ) : null}
        {value}
      </span>
      {suffix ? <span className="text-muted-foreground">{suffix}</span> : null}
      {label ? (
        <span className="text-[9px] tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
      ) : null}
    </span>
  );
}

export function StatusMetrics({
  currentContextLength,
  inputTokens,
  outputTokens,
  cachedInputTokens,
  cacheHitRate,
}: {
  currentContextLength: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheHitRate: number | null;
}) {
  return (
    <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2.5 font-mono text-[11px] leading-none text-muted-foreground sm:flex lg:w-auto lg:justify-end lg:border-t-0 lg:pt-0">
      <StatusMetric
        label="CTX"
        value={formatCompactTokens(currentContextLength)}
        title={`当前上下文长度：${formatContextLength(currentContextLength)} tokens`}
      />
      <StatusMetric
        icon="↑"
        iconClassName="text-[var(--success)]"
        value={formatCompactTokens(inputTokens)}
        title={`累计输入：${formatContextLength(inputTokens)} tokens`}
      />
      <StatusMetric
        icon="↓"
        iconClassName="text-[var(--accent)]"
        value={formatCompactTokens(outputTokens)}
        title={`累计输出：${formatContextLength(outputTokens)} tokens`}
      />
      <StatusMetric
        label="CACHE"
        value={`${formatCacheHitRate(cacheHitRate)}${cacheHitRate === null ? "" : "%"}`}
        suffix={
          cachedInputTokens > 0
            ? formatCompactTokens(cachedInputTokens)
            : undefined
        }
        title={`缓存命中率 ${formatCacheHitRate(cacheHitRate)}${cacheHitRate === null ? "" : "%"} · 命中 ${formatContextLength(cachedInputTokens)} tokens`}
      />
    </div>
  );
}
