import { readFile } from "node:fs/promises";
import {
  deleteConversationArtifact,
  getArtifactFile,
  listConversationArtifacts,
} from "@/lib/artifacts";

export const runtime = "nodejs";

function encodeFilename(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDisposition(type: "inline" | "attachment", filename: string) {
  const fallback = filename.replace(/[^\w.-]+/g, "_") || "artifact";
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeFilename(filename)}`;
}

function previewSecurityHeaders(kind: string) {
  if (kind !== "html" && kind !== "svg") {
    return {};
  }

  return {
    "Content-Security-Policy": [
      "sandbox",
      "default-src 'none'",
      "img-src 'self' data: blob:",
      "style-src 'unsafe-inline'",
      "font-src data:",
      "media-src 'self' data: blob:",
      "script-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
    ].join("; "),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  const { id, artifactId } = await params;
  const file = await getArtifactFile(id, artifactId);

  if (!file) {
    return Response.json(
      {
        error: "Artifact not found.",
      },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const body = await readFile(file.absolutePath);

  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Disposition": contentDisposition(
      download ? "attachment" : "inline",
      file.artifact.name,
    ),
    "Content-Length": String(file.sizeBytes),
    "Content-Type": file.artifact.mimeType,
    "X-Content-Type-Options": "nosniff",
  });

  if (!download) {
    for (const [name, value] of Object.entries(previewSecurityHeaders(file.artifact.kind))) {
      headers.set(name, value);
    }
  }

  return new Response(body, { headers });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  const { id, artifactId } = await params;
  const url = new URL(request.url);
  const deleteFile = url.searchParams.get("deleteFile") === "1";
  const result = await deleteConversationArtifact(id, artifactId, { deleteFile });

  if (!result) {
    return Response.json(
      {
        error: "Artifact not found.",
      },
      { status: 404 },
    );
  }

  const artifacts = await listConversationArtifacts(id);
  return Response.json({
    success: true,
    artifact: result.artifact,
    fileDeleted: result.fileDeleted,
    fileMissing: result.fileMissing,
    artifacts,
  });
}
