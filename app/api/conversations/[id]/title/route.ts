import { z } from "zod";
import { resolveProviderConfig } from "@/lib/ai/model";
import { getConversation, generateConversationTitle } from "@/lib/persistence";
import { providerConfigInputSchema } from "@/lib/provider-config";

export const runtime = "nodejs";

const requestSchema = z.object({
  providerConfig: providerConfigInputSchema.optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const json = await request.json();
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request: providerConfig is malformed.",
      },
      { status: 400 },
    );
  }

  const conversation = await getConversation(id);

  if (!conversation) {
    return Response.json(
      {
        error: "Conversation not found.",
      },
      { status: 404 },
    );
  }

  const providerConfig = resolveProviderConfig(parsed.data.providerConfig);

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
