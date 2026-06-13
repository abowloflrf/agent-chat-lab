"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { ConversationArtifact } from "@/lib/artifact-types";

type ArtifactDrawerProps = {
  conversationId: string | null;
  artifacts: ConversationArtifact[];
  open: boolean;
  onClose: () => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function artifactLabel(kind: ConversationArtifact["kind"]) {
  switch (kind) {
    case "image":
      return "图片";
    case "svg":
      return "SVG";
    case "html":
      return "HTML";
    case "text":
      return "文本";
    case "data":
      return "数据";
    case "pdf":
      return "PDF";
    default:
      return "文件";
  }
}

function canReadSource(kind: ConversationArtifact["kind"]) {
  return kind === "html" || kind === "svg" || kind === "text" || kind === "data";
}

function artifactUrl(conversationId: string, artifactId: string, download = false) {
  const base = `/api/conversations/${encodeURIComponent(conversationId)}/artifacts/${encodeURIComponent(artifactId)}`;
  return download ? `${base}?download=1` : base;
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M5 5l10 10M15 5 5 15"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M10 3.5v8m0 0 3-3m-3 3-3-3M4.5 14.5v1.2a1.8 1.8 0 0 0 1.8 1.8h7.4a1.8 1.8 0 0 0 1.8-1.8v-1.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div>
        <p className="text-sm font-medium text-[#3b3027]">暂无 artifacts</p>
        <p className="mt-2 text-xs leading-5 text-[#8b7e70]">
          当本会话在 workspace 中生成图片、SVG、HTML 或文本产物后，会自动出现在这里。
        </p>
      </div>
    </div>
  );
}

export function ArtifactDrawer({
  conversationId,
  artifacts,
  open,
  onClose,
}: ArtifactDrawerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [sourceState, setSourceState] = useState<{
    artifactId: string;
    text: string | null;
    error: string | null;
  } | null>(null);

  const selectedArtifact = useMemo(() => {
    return artifacts.find((artifact) => artifact.id === selectedId) ?? null;
  }, [artifacts, selectedId]);

  useEffect(() => {
    if (!conversationId || !selectedArtifact || !canReadSource(selectedArtifact.kind)) {
      return;
    }

    let cancelled = false;

    fetch(artifactUrl(conversationId, selectedArtifact.id))
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("读取失败");
        }

        const text = await response.text();
        if (!cancelled) {
          setSourceState({
            artifactId: selectedArtifact.id,
            text,
            error: null,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSourceState({
            artifactId: selectedArtifact.id,
            text: null,
            error: error instanceof Error ? error.message : "读取失败",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, selectedArtifact]);

  if (!open) {
    return null;
  }

  const previewUrl =
    conversationId && selectedArtifact
      ? artifactUrl(conversationId, selectedArtifact.id)
      : null;
  const downloadUrl =
    conversationId && selectedArtifact
      ? artifactUrl(conversationId, selectedArtifact.id, true)
      : null;
  const shouldShowSource =
    selectedArtifact?.kind === "text" ||
    selectedArtifact?.kind === "data" ||
    (Boolean(selectedArtifact) && showSource);
  const selectedSourceState =
    selectedArtifact && sourceState?.artifactId === selectedArtifact.id
      ? sourceState
      : null;
  const hasPreview = Boolean(selectedArtifact && previewUrl);

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-[rgba(36,28,21,0.22)] backdrop-blur-[2px]">
      <aside className="flex h-full w-full max-w-[980px] flex-col border-l border-[rgba(23,23,23,0.1)] bg-[#fffaf4] shadow-[-20px_0_60px_rgba(37,28,20,0.18)] md:w-[78vw] lg:w-[720px]">
        <header className="flex items-center justify-between border-b border-[rgba(23,23,23,0.08)] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#9c5626]">
              Artifacts
            </p>
            <p className="mt-1 text-sm text-[#5d5145]">
              {artifacts.length} 个会话产物
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭 artifacts"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#7b6f63] transition hover:bg-[rgba(23,23,23,0.06)] hover:text-[#2d251e]"
          >
            <CloseIcon />
          </button>
        </header>

        {artifacts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 pb-[env(safe-area-inset-bottom)] md:grid-cols-[250px_minmax(0,1fr)] md:pb-0">
            <div
              className={`min-h-0 overflow-y-auto border-b border-[rgba(23,23,23,0.08)] p-2 md:block md:border-b-0 md:border-r md:p-3 ${
                hasPreview ? "hidden" : "block"
              }`}
            >
              <div className="space-y-0.5">
                {artifacts.map((artifact) => {
                  const selected = artifact.id === selectedArtifact?.id;

                  return (
                    <button
                      key={artifact.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(artifact.id);
                        setShowSource(false);
                      }}
                      className={`w-full rounded-md px-2.5 py-2 text-left transition md:px-3 md:py-2.5 ${
                        selected
                          ? "bg-[#f1e4d7] text-[#2e251d]"
                          : "text-[#5f5348] hover:bg-[rgba(23,23,23,0.04)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium md:text-sm">
                          {artifact.name}
                        </span>
                        <span className="shrink-0 rounded border border-[rgba(23,23,23,0.08)] px-1.5 py-0.5 text-[10px] text-[#8a5a37]">
                          {artifactLabel(artifact.kind)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-[#918477]">
                        {artifact.path}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[#8b7e70] md:text-[11px]">
                        {formatBytes(artifact.sizeBytes)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={`min-h-0 flex-col md:flex ${hasPreview ? "flex" : "hidden"}`}>
              {selectedArtifact && previewUrl ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(23,23,23,0.08)] px-4 py-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(null);
                          setShowSource(false);
                        }}
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#7b6f63] transition hover:bg-[rgba(23,23,23,0.06)] hover:text-[#2d251e]"
                        aria-label="关闭预览"
                        title="关闭预览"
                      >
                        <CloseIcon />
                      </button>
                      <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#2d251e]">
                        {selectedArtifact.name}
                      </p>
                      <p className="mt-1 truncate font-mono text-[10px] text-[#8e8070]">
                        {selectedArtifact.path}
                      </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {canReadSource(selectedArtifact.kind) ? (
                        <button
                          type="button"
                          onClick={() => setShowSource((value) => !value)}
                          className="rounded-md border border-[rgba(23,23,23,0.1)] px-2.5 py-1.5 text-xs text-[#6f6257] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626]"
                        >
                          {shouldShowSource ? "预览" : "源码"}
                        </button>
                      ) : null}
                      {downloadUrl ? (
                        <a
                          href={downloadUrl}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(23,23,23,0.1)] text-[#6f6257] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626]"
                          aria-label="下载 artifact"
                          title="下载"
                        >
                          <DownloadIcon />
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto bg-white">
                    {shouldShowSource && canReadSource(selectedArtifact.kind) ? (
                      <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-[#3e3329]">
                        {selectedSourceState?.error ?? selectedSourceState?.text ?? "读取中..."}
                      </pre>
                    ) : selectedArtifact.kind === "image" ? (
                      <div className="relative min-h-full">
                        <Image
                          src={previewUrl}
                          alt={selectedArtifact.name}
                          fill
                          unoptimized
                          sizes="(max-width: 768px) 100vw, 470px"
                          className="object-contain p-4"
                        />
                      </div>
                    ) : selectedArtifact.kind === "html" || selectedArtifact.kind === "svg" ? (
                      <iframe
                        src={previewUrl}
                        title={selectedArtifact.name}
                        sandbox=""
                        className="h-full min-h-[520px] w-full border-0 bg-white"
                      />
                    ) : selectedArtifact.kind === "pdf" ? (
                      <iframe
                        src={previewUrl}
                        title={selectedArtifact.name}
                        className="h-full min-h-[520px] w-full border-0 bg-white"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-6 text-sm text-[#7f7468]">
                        当前类型暂不支持内嵌预览，请下载查看。
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="hidden h-full items-center justify-center px-8 text-center md:flex">
                  <div>
                    <p className="text-sm font-medium text-[#3b3027]">
                      选择一个 artifact
                    </p>
                    <p className="mt-2 text-xs leading-5 text-[#8b7e70]">
                      从左侧列表选择文件后在这里预览或下载。
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
