import { z } from "zod";
import { getAllConversations, createConversation } from "@/lib/persistence";

export const runtime = "nodejs";

const listRequestSchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createRequestSchema = z.object({
  title: z.string().trim().max(200).optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = listRequestSchema.safeParse({
    query: searchParams.get("query") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    offset: searchParams.get("offset") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request: query must be <= 200 chars, limit 1-100, offset >= 0.",
      },
      { status: 400 },
    );
  }

  const result = await getAllConversations(parsed.data);
  return Response.json(result);
}

export async function POST(request: Request) {
  const json = await request.json();
  const parsed = createRequestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request: title must be a string with max 200 characters.",
      },
      { status: 400 },
    );
  }

  const conversation = await createConversation(parsed.data.title);
  return Response.json({ conversation });
}
