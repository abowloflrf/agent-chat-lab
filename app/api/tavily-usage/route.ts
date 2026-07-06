import { getSystemSettings } from "@/lib/settings";
import { logger } from "@/lib/logger";

const tavilyUsageLog = logger.child({ module: "TavilyUsage" });

export async function GET() {
  try {
    const settings = await getSystemSettings();
    const apiKey = settings.tavilyApiKey || process.env.TAVILY_API_KEY || "";

    if (!apiKey) {
      return Response.json({ error: "Tavily API Key 未配置" }, { status: 400 });
    }

    const res = await fetch("https://api.tavily.com/usage", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const text = await res.text();
      tavilyUsageLog.warn({ status: res.status }, "Tavily usage API returned error");
      return Response.json(
        { error: `Tavily API 返回错误: ${res.status} ${text}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return Response.json({ usage: data });
  } catch (err) {
    tavilyUsageLog.error({ err }, "failed to fetch Tavily usage");
    return Response.json(
      { error: err instanceof Error ? err.message : "未知错误" },
      { status: 500 },
    );
  }
}
