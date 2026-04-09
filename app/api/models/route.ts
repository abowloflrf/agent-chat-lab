import { z } from "zod";
import { providerConfigInputSchema } from "@/lib/provider-config";
import { getRuntimeProviderConfig, resolveProviderConfig } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  providerConfig: providerConfigInputSchema.optional(),
});

type ModelsResponse =
  | {
      data?: Array<{
        id?: string;
        object?: string;
      }>;
    }
  | undefined;

export async function POST(request: Request) {
  const json = await request.json();
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request: missing valid providerConfig.",
      },
      { status: 400 },
    );
  }

  const providerConfig = parsed.data.providerConfig
    ? resolveProviderConfig(parsed.data.providerConfig)
    : await getRuntimeProviderConfig();

  if (!providerConfig.baseUrl || !providerConfig.apiKey) {
    return Response.json(
      {
        error: "Base URL and API Key are required to fetch model list.",
      },
      { status: 400 },
    );
  }

  const response = await fetch(`${providerConfig.baseUrl}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${providerConfig.apiKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();

    return Response.json(
      {
        error: `Failed to fetch models, status ${response.status}. ${text.slice(0, 300)}`,
      },
      { status: response.status },
    );
  }

  const result = (await response.json()) as ModelsResponse;
  const models = (result?.data ?? [])
    .map((item) => item.id?.trim())
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => left.localeCompare(right, "zh-CN"));

  return Response.json({
    models,
  });
}
