import { getConversation } from "@/lib/persistence";
import { listConversationArtifacts } from "@/lib/artifacts";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conversation = await getConversation(id);

  if (!conversation) {
    return Response.json(
      {
        error: "Conversation not found.",
      },
      { status: 404 },
    );
  }

  const artifacts = await listConversationArtifacts(id);
  return Response.json({ artifacts });
}
