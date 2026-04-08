import { getBuiltInToolUsageCounts } from "@/lib/persistence";

export const runtime = "nodejs";

export async function GET() {
  const counts = await getBuiltInToolUsageCounts();
  return Response.json({ counts });
}
