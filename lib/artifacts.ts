import "server-only";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";
import { and, desc, eq } from "drizzle-orm";
import type { UIMessage } from "ai";
import { resolveBashToolWorkdir } from "@/lib/ai/bash-server";
import { db, ensureDatabase } from "@/lib/db/client";
import { artifacts } from "@/lib/db/schema";
import type {
  ArtifactKind,
  ArtifactSource,
  ConversationArtifact,
} from "@/lib/artifact-types";
import type { ChatUIMessage } from "@/lib/observability";

const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_SCAN_FILES = 5000;
const SCAN_TIME_PADDING_MS = 3000;
const IGNORED_SCAN_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "data",
  "drizzle",
]);

const EXTENSION_INFO: Record<string, { kind: ArtifactKind; mimeType: string }> = {
  ".png": { kind: "image", mimeType: "image/png" },
  ".jpg": { kind: "image", mimeType: "image/jpeg" },
  ".jpeg": { kind: "image", mimeType: "image/jpeg" },
  ".webp": { kind: "image", mimeType: "image/webp" },
  ".gif": { kind: "image", mimeType: "image/gif" },
  ".svg": { kind: "svg", mimeType: "image/svg+xml" },
  ".html": { kind: "html", mimeType: "text/html; charset=utf-8" },
  ".htm": { kind: "html", mimeType: "text/html; charset=utf-8" },
  ".txt": { kind: "text", mimeType: "text/plain; charset=utf-8" },
  ".md": { kind: "text", mimeType: "text/markdown; charset=utf-8" },
  ".json": { kind: "data", mimeType: "application/json; charset=utf-8" },
  ".csv": { kind: "data", mimeType: "text/csv; charset=utf-8" },
  ".pdf": { kind: "pdf", mimeType: "application/pdf" },
};

type ArtifactCandidate = {
  absolutePath: string;
  relativePath: string;
  messageId: string | null;
  toolCallId: string | null;
  source: ArtifactSource;
};

type WorkspacePath = {
  root: string;
  absolutePath: string;
  relativePath: string;
};

type ArtifactWindow = {
  startedAt: number;
  finishedAt: number;
};

function toIsoString(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function normalizeRelativePath(path: string) {
  return path.split(sep).join("/");
}

function isInsideDirectory(root: string, child: string) {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function getWorkspaceRoot() {
  return realpath(resolveBashToolWorkdir());
}

async function resolveWorkspacePath(inputPath: string): Promise<WorkspacePath | null> {
  const root = await getWorkspaceRoot();
  const candidatePath = isAbsolute(inputPath)
    ? inputPath
    : resolvePath(root, inputPath);

  let absolutePath: string;
  try {
    absolutePath = await realpath(candidatePath);
  } catch {
    return null;
  }

  if (!isInsideDirectory(root, absolutePath)) {
    return null;
  }

  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return null;
  }

  return {
    root,
    absolutePath,
    relativePath: normalizeRelativePath(relative(root, absolutePath)),
  };
}

function getFileInfo(path: string) {
  return EXTENSION_INFO[extname(path).toLowerCase()] ?? null;
}

function getToolName(part: UIMessage["parts"][number]) {
  if (part.type === "dynamic-tool") {
    return "toolName" in part && typeof part.toolName === "string"
      ? part.toolName
      : null;
  }

  if (part.type.startsWith("tool-")) {
    return part.type.replace(/^tool-/, "");
  }

  return null;
}

function extractOutputPath(output: unknown) {
  if (!output || typeof output !== "object") {
    return null;
  }

  const record = output as { path?: unknown };
  return typeof record.path === "string" ? record.path : null;
}

function collectToolCandidates(messages: ChatUIMessage[]) {
  const candidates: Array<{
    path: string;
    messageId: string;
    toolCallId: string | null;
  }> = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      const isToolPart =
        part.type === "dynamic-tool" || part.type.startsWith("tool-");
      if (!isToolPart || !("state" in part) || part.state !== "output-available") {
        continue;
      }

      const toolName = getToolName(part);
      if (toolName !== "write" && toolName !== "edit") {
        continue;
      }

      const path = "output" in part ? extractOutputPath(part.output) : null;
      if (!path) {
        continue;
      }

      candidates.push({
        path,
        messageId: message.id,
        toolCallId:
          "toolCallId" in part && typeof part.toolCallId === "string"
            ? part.toolCallId
            : null,
      });
    }
  }

  return candidates;
}

function getLatestArtifactWindow(messages: ChatUIMessage[]): ArtifactWindow | null {
  const windows = messages.flatMap((message) => {
    if (message.role !== "assistant" || !message.metadata) {
      return [];
    }

    const metadata = message.metadata as {
      startedAt?: unknown;
      finishedAt?: unknown;
      createdAt?: unknown;
    };
    const startedAt =
      typeof metadata.startedAt === "number"
        ? metadata.startedAt
        : typeof metadata.createdAt === "number"
          ? metadata.createdAt
          : null;

    if (startedAt === null) {
      return [];
    }

    return [
      {
        startedAt,
        finishedAt:
          typeof metadata.finishedAt === "number" ? metadata.finishedAt : Date.now(),
      },
    ];
  });

  return windows.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function artifactId(conversationId: string, relativePath: string) {
  const digest = createHash("sha1")
    .update(conversationId)
    .update("\0")
    .update(relativePath)
    .digest("hex");
  return `artifact_${digest.slice(0, 32)}`;
}

async function buildArtifactRow(
  conversationId: string,
  candidate: ArtifactCandidate,
) {
  const info = getFileInfo(candidate.relativePath);
  if (!info) {
    return null;
  }

  const fileStat = await stat(candidate.absolutePath).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size <= 0 || fileStat.size > MAX_ARTIFACT_BYTES) {
    return null;
  }

  const now = Date.now();
  const sha256 = await hashFile(candidate.absolutePath);

  return {
    id: artifactId(conversationId, candidate.relativePath),
    conversationId,
    messageId: candidate.messageId,
    toolCallId: candidate.toolCallId,
    path: candidate.relativePath,
    name: basename(candidate.relativePath),
    kind: info.kind,
    mimeType: info.mimeType,
    sizeBytes: fileStat.size,
    mtimeMs: Math.floor(fileStat.mtimeMs),
    sha256,
    source: candidate.source,
    createdAt: now,
    updatedAt: now,
  };
}

async function scanWorkspaceForArtifacts(window: ArtifactWindow) {
  const root = await getWorkspaceRoot();
  const start = window.startedAt - SCAN_TIME_PADDING_MS;
  const end = window.finishedAt + SCAN_TIME_PADDING_MS;
  const candidates: ArtifactCandidate[] = [];
  let visitedFiles = 0;

  async function visit(dir: string) {
    if (visitedFiles >= MAX_SCAN_FILES) {
      return;
    }

    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (visitedFiles >= MAX_SCAN_FILES) {
        return;
      }

      if (entry.name.startsWith(".") && entry.name !== ".") {
        if (IGNORED_SCAN_DIRS.has(entry.name)) {
          continue;
        }
      }

      const absolutePath = resolvePath(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_SCAN_DIRS.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      visitedFiles += 1;
      if (!getFileInfo(entry.name)) {
        continue;
      }

      const fileStat = await lstat(absolutePath).catch(() => null);
      if (
        !fileStat?.isFile() ||
        fileStat.size <= 0 ||
        fileStat.size > MAX_ARTIFACT_BYTES ||
        fileStat.mtimeMs < start ||
        fileStat.mtimeMs > end
      ) {
        continue;
      }

      const resolved = await resolveWorkspacePath(absolutePath);
      if (!resolved) {
        continue;
      }

      candidates.push({
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
        messageId: null,
        toolCallId: null,
        source: "scan",
      });
    }
  }

  await visit(root);
  return candidates;
}

function rowToArtifact(row: typeof artifacts.$inferSelect): ConversationArtifact {
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId,
    toolCallId: row.toolCallId,
    path: row.path,
    name: row.name,
    kind: row.kind as ArtifactKind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    mtimeMs: row.mtimeMs,
    sha256: row.sha256,
    source: row.source as ArtifactSource,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export async function discoverConversationArtifacts(
  conversationId: string,
  messages: ChatUIMessage[],
) {
  await ensureDatabase();

  const candidates = new Map<string, ArtifactCandidate>();

  for (const toolCandidate of collectToolCandidates(messages)) {
    const resolved = await resolveWorkspacePath(toolCandidate.path);
    if (!resolved) {
      continue;
    }

    candidates.set(resolved.relativePath, {
      absolutePath: resolved.absolutePath,
      relativePath: resolved.relativePath,
      messageId: toolCandidate.messageId,
      toolCallId: toolCandidate.toolCallId,
      source: "tool",
    });
  }

  const window = getLatestArtifactWindow(messages);
  if (window) {
    const scanned = await scanWorkspaceForArtifacts(window);
    for (const candidate of scanned) {
      if (!candidates.has(candidate.relativePath)) {
        candidates.set(candidate.relativePath, candidate);
      }
    }
  }

  const rows = (
    await Promise.all(
      [...candidates.values()].map((candidate) =>
        buildArtifactRow(conversationId, candidate),
      ),
    )
  ).filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) {
    return [];
  }

  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(artifacts)
        .values(row)
        .onConflictDoUpdate({
          target: [artifacts.conversationId, artifacts.path],
          set: {
            messageId: row.messageId,
            toolCallId: row.toolCallId,
            name: row.name,
            kind: row.kind,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            mtimeMs: row.mtimeMs,
            sha256: row.sha256,
            source: row.source,
            updatedAt: row.updatedAt,
          },
        })
        .run();
    }
  });

  return rows.map((row) => rowToArtifact(row));
}

export async function listConversationArtifacts(
  conversationId: string,
): Promise<ConversationArtifact[]> {
  await ensureDatabase();

  const rows = db
    .select()
    .from(artifacts)
    .where(eq(artifacts.conversationId, conversationId))
    .orderBy(desc(artifacts.updatedAt))
    .all();

  return rows.map(rowToArtifact);
}

export async function getConversationArtifact(
  conversationId: string,
  artifactIdValue: string,
): Promise<ConversationArtifact | null> {
  await ensureDatabase();

  const row = db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.conversationId, conversationId),
        eq(artifacts.id, artifactIdValue),
      ),
    )
    .all()[0];

  return row ? rowToArtifact(row) : null;
}

export async function getArtifactFile(
  conversationId: string,
  artifactIdValue: string,
) {
  const artifact = await getConversationArtifact(conversationId, artifactIdValue);
  if (!artifact) {
    return null;
  }

  const resolved = await resolveWorkspacePath(artifact.path);
  if (!resolved || resolved.relativePath !== artifact.path) {
    return null;
  }

  const fileStat = await stat(resolved.absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return null;
  }

  return {
    artifact,
    absolutePath: resolved.absolutePath,
    sizeBytes: fileStat.size,
  };
}
