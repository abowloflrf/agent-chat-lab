import { getConversation } from "@/lib/persistence";
import { ChatShell } from "@/components/chat-shell";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string }>;
}) {
  const params = await searchParams;
  const conversationId = params.conversationId;

  let conversation = null;

  if (conversationId) {
    conversation = await getConversation(conversationId);
  }

  return (
    <ChatShell
      initialConversationId={conversation?.conversationId ?? null}
      initialConversationTitle={conversation?.title ?? null}
      initialMessages={conversation?.messages ?? []}
      initialSessionConfig={conversation?.sessionConfig ?? null}
      initialArtifacts={conversation?.artifacts ?? []}
    />
  );
}
