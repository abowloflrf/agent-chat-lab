import { z } from "zod";
import { testMcpServer } from "@/lib/ai/mcp";
import { resolveBaseUrl } from "@/lib/ai/mcp-oauth";
import { mcpAuthTypes } from "@/lib/provider-config";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().url(),
  authType: z.enum(mcpAuthTypes).default("header"),
  oauthScopes: z.string().trim().max(500).optional(),
  headers: z
    .array(
      z.object({
        key: z.string().trim().max(80),
        value: z.string().trim().max(2000),
      }),
    )
    .max(20)
    .default([]),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request: a valid MCP server URL is required.",
      },
      { status: 400 },
    );
  }

  const { id, name, url, authType, oauthScopes, headers } = parsed.data;

  // OAuth tests reuse the stored session, which is keyed by the saved server id.
  if (authType === "oauth" && !id) {
    return Response.json(
      { error: "请先保存该 MCP Server 再测试 OAuth 连接。" },
      { status: 400 },
    );
  }

  try {
    const tools = await testMcpServer(
      {
        id: id ?? "",
        name: name ?? "MCP Server",
        url,
        authType,
        oauthScopes: oauthScopes ?? "",
        headers: headers.filter((header) => header.key),
      },
      resolveBaseUrl(request),
    );

    return Response.json({ tools });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to connect to MCP server.";

    return Response.json(
      {
        error: message.slice(0, 300),
      },
      { status: 502 },
    );
  }
}
