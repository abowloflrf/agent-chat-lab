import { getConversation, generateConversationTitle } from "@/lib/persistence";
import { getRuntimeProviderConfig } from "@/lib/settings";

export const runtime = "nodejs";

export async function POST(
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

  const providerConfig = await getRuntimeProviderConfig();

  if (!providerConfig.apiKey || !providerConfig.model) {
    return Response.json(
      {
        error:
          "No valid model configuration. Please configure base URL, API Key and model at /settings, or set OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL environment variables.",
      },
      { status: 400 },
    );
  }

  const result = await generateConversationTitle(
    id,
    conversation.messages,
    providerConfig,
  );

  if (!result.success || !result.title) {
    return Response.json(
      {
        error: "Failed to generate conversation title.",
      },
      { status: 500 },
    );
  }

  return Response.json({
    success: true,
    title: result.title,
  });
}
