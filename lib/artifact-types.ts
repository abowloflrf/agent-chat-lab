export type ArtifactKind =
  | "image"
  | "svg"
  | "html"
  | "text"
  | "data"
  | "pdf"
  | "other";

export type ArtifactSource = "tool" | "scan";

export type ConversationArtifact = {
  id: string;
  conversationId: string;
  messageId: string | null;
  toolCallId: string | null;
  path: string;
  name: string;
  kind: ArtifactKind;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
  source: ArtifactSource;
  createdAt: string;
  updatedAt: string;
};
