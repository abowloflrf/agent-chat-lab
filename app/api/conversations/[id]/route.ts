import { z } from "zod";
import { getConversation, deleteConversation, renameConversation } from "@/lib/persistence";

export const runtime = "nodejs";

const renameRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export async function GET(
  request: Request,
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

  return Response.json({ conversation });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteConversation(id);
  return Response.json({ success: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const json = await request.json();
  const parsed = renameRequestSchema.safeParse(json);

  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid request: title must be a non-empty string with max 200 characters.",
      },
      { status: 400 },
    );
  }

  const conversation = await renameConversation(id, parsed.data.title);
  return Response.json({ conversation });
}
