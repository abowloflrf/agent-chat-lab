"use client";

import { useCallback, useEffect, useState } from "react";
import { StatsOverviewCards } from "@/components/stats-overview-cards";
import { StatsTrendChart } from "@/components/stats-trend-chart";
import { StatsModelTable } from "@/components/stats-model-table";
import type { ModelUsage, UsageOverview } from "@/lib/persistence";

type LoadState = "loading" | "error" | "ready";

type StatsData = {
  overview: UsageOverview;
  models: ModelUsage[];
};

async function fetchStats(): Promise<StatsData> {
  const [overviewRes, modelsRes] = await Promise.all([
    fetch("/api/stats/overview"),
    fetch("/api/stats/models"),
  ]);

  if (!overviewRes.ok || !modelsRes.ok) {
    throw new Error("加载用量统计失败。");
  }

  const overview = (await overviewRes.json()) as { overview: UsageOverview };
  const models = (await modelsRes.json()) as { models: ModelUsage[] };

  return {
    overview: overview.overview,
    models: models.models,
  };
}

export function StatsDashboard() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") {
      setLoadState("loading");
    } else {
      setRefreshing(true);
      setRefreshToken((token) => token + 1);
    }

    try {
      const next = await fetchStats();
      setData(next);
      setLoadState("ready");
    } catch {
      if (mode === "initial") {
        setLoadState("error");
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchStats()
      .then((next) => {
        if (!cancelled) {
          setData(next);
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">用量统计</p>
          <p className="mt-2 text-sm leading-6 text-[#6e665d]">
            按天的 Token 消耗趋势、模型用量分布与性能洞察。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load("refresh")}
          disabled={refreshing || loadState === "loading"}
          className="shrink-0 rounded-full bg-[#171717] px-4 py-1.5 text-xs font-medium text-white transition hover:bg-[#2b241d] disabled:opacity-50"
        >
          {refreshing ? "刷新中…" : "刷新"}
        </button>
      </div>

      {loadState === "loading" ? (
        <div className="py-12 text-center text-sm text-[#8a8176]">加载用量统计中…</div>
      ) : loadState === "error" ? (
        <div className="accent-line py-12 pl-4">
          <p className="text-lg font-semibold tracking-[-0.02em] text-[#352d25]">
            加载用量统计失败
          </p>
          <p className="mt-2 text-sm leading-6 text-[#6e665d]">请检查网络后重试。</p>
          <button
            type="button"
            onClick={() => void load("initial")}
            className="mt-4 rounded-full bg-[#171717] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2b241d]"
          >
            重试
          </button>
        </div>
      ) : data ? (
        <div className="space-y-4">
          <StatsOverviewCards overview={data.overview} />
          <StatsTrendChart refreshToken={refreshToken} />
          <StatsModelTable models={data.models} />
        </div>
      ) : null}
    </div>
  );
}
