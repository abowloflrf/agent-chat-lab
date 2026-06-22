"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageTrendRow } from "@/lib/persistence";
import { formatDayKeyShort, toDayKey } from "@/lib/datetime";
import { formatCompactTokens, formatTokenCount } from "@/lib/format";

type StatsTrendChartProps = {
  refreshToken: number;
};

const PALETTE = [
  "#c96a2b",
  "#3f7d57",
  "#5a6b8c",
  "#b0894e",
  "#9c5626",
  "#6d6257",
  "#8a7b34",
  "#a8536b",
];

const RANGES = [
  { label: "近 7 天", days: 7 },
  { label: "近 30 天", days: 30 },
  { label: "近 90 天", days: 90 },
];

const DAY_MS = 86_400_000;
const MONO_FONT = "var(--font-ibm-plex-mono)";

type TooltipEntry = { dataKey?: string | number; value?: number; color?: string };

function ChartTooltip(props: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}) {
  const { active, payload, label } = props;

  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const items = payload.filter((entry) => (entry.value ?? 0) > 0);

  if (items.length === 0) {
    return null;
  }

  const total = items.reduce((sum, entry) => sum + (entry.value ?? 0), 0);

  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2 text-[11px] shadow-lg">
      <p className="mb-1.5 font-mono font-medium text-foreground">
        {label} · 共 {formatTokenCount(total)}
      </p>
      <div className="space-y-0.5">
        {items.map((entry) => (
          <p key={String(entry.dataKey)} className="flex items-center gap-1.5 text-muted-foreground">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: entry.color }}
            />
            <span className="font-mono">{String(entry.dataKey)}</span>
            <span className="ml-auto pl-3 font-mono tabular-nums">
              {formatTokenCount(entry.value ?? 0)}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

export function StatsTrendChart({ refreshToken }: StatsTrendChartProps) {
  const [rangeDays, setRangeDays] = useState(30);
  const [trends, setTrends] = useState<UsageTrendRow[]>([]);
  const [anchorMs, setAnchorMs] = useState(0);
  const [loading, setLoading] = useState(true);

  const selectRange = (days: number) => {
    if (days === rangeDays) {
      return;
    }
    setRangeDays(days);
    setLoading(true);
  };

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/stats/trends?days=${rangeDays}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
      .then((payload: { trends: UsageTrendRow[] }) => {
        if (!cancelled) {
          setTrends(payload.trends);
          setAnchorMs(Date.now());
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTrends([]);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rangeDays, refreshToken]);

  const modelIds = useMemo(() => {
    const ids: string[] = [];
    for (const row of trends) {
      if (!ids.includes(row.modelId)) {
        ids.push(row.modelId);
      }
    }
    return ids;
  }, [trends]);

  // Build a continuous day axis (filling gaps with zeros) and pivot models into columns.
  const chartData = useMemo(() => {
    if (anchorMs === 0) {
      return [];
    }

    const buckets = new Map<number, Record<string, number>>();
    const days: number[] = [];

    for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
      const dayKey = toDayKey(anchorMs - offset * DAY_MS);
      days.push(dayKey);
      buckets.set(dayKey, {});
    }

    for (const row of trends) {
      const bucket = buckets.get(row.dayKey);
      if (bucket) {
        bucket[row.modelId] = (bucket[row.modelId] ?? 0) + row.totalTokens;
      }
    }

    return days.map((dayKey) => ({
      label: formatDayKeyShort(dayKey),
      ...buckets.get(dayKey),
    }));
  }, [trends, rangeDays, anchorMs]);

  const colorOf = (modelId: string) => PALETTE[modelIds.indexOf(modelId) % PALETTE.length];
  const hasData = modelIds.length > 0;

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-[var(--panel)]">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          Token 消耗趋势
        </h2>
        <div className="flex gap-1.5">
          {RANGES.map((range) => (
            <button
              key={range.days}
              type="button"
              onClick={() => selectRange(range.days)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                rangeDays === range.days
                  ? "bg-foreground text-primary-foreground"
                  : "bg-[var(--surface-muted)] text-muted-foreground hover:bg-muted"
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2 py-4 sm:px-4">
        {loading ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
            加载趋势中…
          </div>
        ) : !hasData ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
            该时间范围内暂无数据。
          </div>
        ) : (
          <>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--grid-line)" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)", fontFamily: MONO_FONT }}
                    minTickGap={16}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    tickFormatter={(value: number) => formatCompactTokens(value)}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)", fontFamily: MONO_FONT }}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--surface-muted)" }}
                    content={<ChartTooltip />}
                  />
                  {modelIds.map((modelId) => (
                    <Bar
                      key={modelId}
                      dataKey={modelId}
                      stackId="tokens"
                      fill={colorOf(modelId)}
                      maxBarSize={48}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {modelIds.map((modelId) => (
                <span
                  key={modelId}
                  className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-[3px]"
                    style={{ backgroundColor: colorOf(modelId) }}
                  />
                  <span className="font-mono">{modelId}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
