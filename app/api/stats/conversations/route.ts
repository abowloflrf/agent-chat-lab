import { listConversationStats } from "@/lib/persistence";

export const runtime = "nodejs";

export async function GET() {
  const conversations = await listConversationStats();
  return Response.json({ conversations });
}
