import { getModelUsage } from "@/lib/persistence";

export const runtime = "nodejs";

export async function GET() {
  const models = await getModelUsage();
  return Response.json({ models });
}
