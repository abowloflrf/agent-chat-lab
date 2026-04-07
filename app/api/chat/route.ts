import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { getChatModel, resolveProviderConfig } from "@/lib/ai/model";
import { systemPrompt } from "@/lib/ai/system-prompt";
import { agentTools } from "@/lib/ai/tools";
import { providerConfigInputSchema } from "@/lib/provider-config";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  messages: z.array(z.custom<UIMessage>()),
  providerConfig: providerConfigInputSchema.optional(),
});

function stripMessageId(message: UIMessage): Omit<UIMessage, "id"> {
  const { id, ...rest } = message;
  void id;
  return rest;
}

export async function POST(request: Request) {
  const json = await request.json();
  console.log('Received request body:', JSON.stringify(json, null, 2));
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    console.log('Validation failed:', parsed.error);
    return Response.json(
      {
        error: "Invalid request: missing valid messages array.",
      },
      { status: 400 },
    );
  }

  const modelMessages = await convertToModelMessages(
    parsed.data.messages.map(stripMessageId),
    {
      tools: agentTools,
    },
  );
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

  const result = streamText({
    model: getChatModel(providerConfig),
    system: systemPrompt,
    messages: modelMessages,
    tools: agentTools,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
