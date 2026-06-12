import { getUsageOverview } from "@/lib/persistence";

export const runtime = "nodejs";

export async function GET() {
  const overview = await getUsageOverview();
  return Response.json({ overview });
}
