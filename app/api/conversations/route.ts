import { z } from "zod";
import { getAllConversations, createConversation } from "@/lib/persistence";

export const runtime = "nodejs";

const createRequestSchema = z.object({
  title: z.string().trim().max(200).optional(),
});

export async function GET() {
  const conversations = await getAllConversations();
  return Response.json({ conversations });
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
