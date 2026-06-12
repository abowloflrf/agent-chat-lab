import { z } from "zod";
import { getUsageTrends } from "@/lib/persistence";

export const runtime = "nodejs";

const trendsRequestSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = trendsRequestSchema.safeParse({
    days: searchParams.get("days") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request: days must be an integer between 1 and 365." },
      { status: 400 },
    );
  }

  const trends = await getUsageTrends(parsed.data.days ?? 30);
  return Response.json({ trends });
}
