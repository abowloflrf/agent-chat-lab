import { logger } from "@/lib/logger";

// Exa usage is reported per API key via the admin API (a separate service key
// and host from the search key). We list the team's keys, then sum each key's
// usage over the period. The free tier is expressed as a request-count cap.
const EXA_ADMIN_API_KEYS_URL = "https://admin-api.exa.ai/team-management/api-keys";
const EXA_FREE_LIMIT = 20000;

const exaUsageLog = logger.child({ module: "ExaUsage" });

type ExaUsageResponse = {
  total_cost_usd?: number;
  cost_breakdown?: Array<{
    price_name?: string;
    quantity?: number;
    amount_usd?: number;
  }>;
};

export async function GET() {
  try {
    const serviceKey = process.env.EXA_SERVICE_KEY || "";

    if (!serviceKey) {
      return Response.json({ error: "Exa Service Key 未配置（EXA_SERVICE_KEY）" }, { status: 400 });
    }

    const headers = { "x-api-key": serviceKey };

    // Default period: the current calendar month in UTC (Exa periods are ISO/UTC).
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();

    const listRes = await fetch(EXA_ADMIN_API_KEYS_URL, { headers });
    if (!listRes.ok) {
      const text = await listRes.text();
      exaUsageLog.warn({ status: listRes.status }, "Exa admin API returned error");
      return Response.json(
        { error: `Exa API 返回错误: ${listRes.status} ${text}` },
        { status: listRes.status },
      );
    }

    const listData = (await listRes.json()) as { apiKeys?: Array<{ id?: string }> };
    const keyIds = (listData.apiKeys ?? []).map((key) => key.id).filter(Boolean) as string[];

    const usages = await Promise.all(
      keyIds.map(async (id) => {
        const url = `${EXA_ADMIN_API_KEYS_URL}/${id}/usage?start_date=${encodeURIComponent(periodStart)}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return null;
        return (await res.json()) as ExaUsageResponse;
      }),
    );

    let count = 0;
    let costUsd = 0;
    let searchCount = 0;
    let contentsCount = 0;

    for (const usage of usages) {
      if (!usage) continue;
      costUsd += usage.total_cost_usd ?? 0;
      for (const item of usage.cost_breakdown ?? []) {
        const quantity = item.quantity ?? 0;
        count += quantity;
        const name = item.price_name ?? "";
        if (name.includes("Search")) searchCount += quantity;
        else if (name.includes("Contents")) contentsCount += quantity;
      }
    }

    return Response.json({
      usage: {
        count,
        limit: EXA_FREE_LIMIT,
        costUsd,
        searchCount,
        contentsCount,
        periodStart,
      },
    });
  } catch (err) {
    exaUsageLog.error({ err }, "failed to fetch Exa usage");
    return Response.json(
      { error: err instanceof Error ? err.message : "未知错误" },
      { status: 500 },
    );
  }
}
