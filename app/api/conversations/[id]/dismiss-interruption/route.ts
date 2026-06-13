import { clearConversationInterruption } from "@/lib/persistence";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cleared = await clearConversationInterruption(id);

  return Response.json({
    success: true,
    cleared,
  });
}
