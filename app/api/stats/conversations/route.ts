import { listConversationStats } from "@/lib/persistence";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const statsLog = logger.child({ module: "Stats" });

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = parsePositiveInt(searchParams.get("page"), 1);
  const requestedPageSize = parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
  const query = searchParams.get("q") ?? undefined;
  const startedAt = performance.now();
  const result = await listConversationStats({
    query,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const queryDurationMs = Math.round(performance.now() - startedAt);

  statsLog.info(
    { queryDurationMs, page, pageSize, total: result.total },
    "conversation stats query",
  );

  return Response.json({
    ...result,
    page,
    pageSize,
    queryDurationMs,
  });
}
