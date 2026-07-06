import { z } from "zod";
import { providerConfigInputSchema } from "@/lib/provider-config";
import { getRuntimeProviderConfig, resolveProviderConfig } from "@/lib/settings";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

const modelsLog = logger.child({ module: "Models" });

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

  let response: Response;
  try {
    response = await fetch(`${providerConfig.baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error.";
    modelsLog.error({ baseUrl: providerConfig.baseUrl, error: message }, "model list request failed");
    return Response.json(
      { error: `Failed to reach ${providerConfig.baseUrl}/models. ${message}` },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const text = await response.text();

    modelsLog.warn(
      { baseUrl: providerConfig.baseUrl, status: response.status },
      "model list upstream returned error",
    );
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

  modelsLog.info({ baseUrl: providerConfig.baseUrl, models: models.length }, "model list fetched");
  return Response.json({
    models,
  });
}
