import { z } from "zod";
import { testMcpServer } from "@/lib/ai/mcp";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().url(),
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

  const { name, url, headers } = parsed.data;

  try {
    const tools = await testMcpServer({
      name: name ?? "MCP Server",
      url,
      headers: headers.filter((header) => header.key),
    });

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
