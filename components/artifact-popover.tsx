"use client";

import Image from "next/image";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ConversationArtifact } from "@/lib/artifact-types";

type ArtifactPopoverProps = {
  conversationId: string;
  artifacts: ConversationArtifact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

function artifactUrl(conversationId: string, artifactId: string, download = false) {
  const base = `/api/conversations/${encodeURIComponent(conversationId)}/artifacts/${encodeURIComponent(artifactId)}`;
  return download ? `${base}?download=1` : base;
}

function canReadSource(kind: ConversationArtifact["kind"]) {
  return kind === "html" || kind === "svg" || kind === "text" || kind === "data";
}

function subscribeToClientReady() {
  return () => {};
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

function BodyPortal({ children }: { children: ReactNode }) {
  const isClient = useSyncExternalStore(
    subscribeToClientReady,
    getClientSnapshot,
    getServerSnapshot,
  );

  return isClient ? createPortal(children, document.body) : null;
}

function ArtifactIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="h-3.5 w-3.5"
    >
      <path
        d="M4 5.6A2.1 2.1 0 0 1 6.1 3.5h4.8L16 8.6v5.8a2.1 2.1 0 0 1-2.1 2.1H6.1A2.1 2.1 0 0 1 4 14.4V5.6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10.8 3.7v3.2A1.2 1.2 0 0 0 12 8.1h3.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M12.5 4.5 7 10l5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
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

function PreviewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M2.8 10s2.5-4.4 7.2-4.4S17.2 10 17.2 10s-2.5 4.4-7.2 4.4S2.8 10 2.8 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
        stroke="currentColor"
        strokeWidth="1.5"
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
    <div className="px-4 py-7 text-center">
      <p className="text-sm font-medium text-[#3b3027]">暂无 Artifacts</p>
      <p className="mt-1.5 text-xs leading-5 text-[#9e9285]">
        会话生成图片、HTML、文本等产物后会自动显示在这里。
      </p>
    </div>
  );
}

function ArtifactPreview({
  artifact,
  conversationId,
  onClose,
}: {
  artifact: ConversationArtifact;
  conversationId: string;
  onClose: () => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const [sourceState, setSourceState] = useState<{
    artifactId: string;
    text: string | null;
    error: string | null;
  } | null>(null);

  const previewUrl = useMemo(
    () => artifactUrl(conversationId, artifact.id),
    [artifact.id, conversationId],
  );
  const downloadUrl = useMemo(
    () => artifactUrl(conversationId, artifact.id, true),
    [artifact.id, conversationId],
  );
  const shouldShowSource =
    artifact.kind === "text" || artifact.kind === "data" || showSource;
  const selectedSourceState =
    sourceState?.artifactId === artifact.id ? sourceState : null;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!canReadSource(artifact.kind)) {
      return;
    }

    let cancelled = false;

    fetch(previewUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("读取失败");
        }

        const text = await response.text();
        if (!cancelled) {
          setSourceState({
            artifactId: artifact.id,
            text,
            error: null,
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSourceState({
            artifactId: artifact.id,
            text: null,
            error: error instanceof Error ? error.message : "读取失败",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [artifact.id, artifact.kind, previewUrl]);

  const previewDialog = (
    <div
      className="fixed inset-0 z-[70] bg-[rgba(36,28,21,0.28)] backdrop-blur-[2px] md:flex md:items-center md:justify-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${artifact.name}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex h-dvh w-full flex-col bg-[#fffaf4] text-[#2d251e] shadow-[0_24px_80px_rgba(37,28,20,0.22)] md:h-[calc(100dvh-3rem)] md:max-h-[760px] md:w-[min(92vw,1120px)] md:overflow-hidden md:rounded-xl md:border md:border-[rgba(23,23,23,0.1)]">
        <header className="flex items-center justify-between gap-3 border-b border-[rgba(23,23,23,0.08)] px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-4 md:pt-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-[#6f6257] transition hover:bg-[rgba(23,23,23,0.06)] hover:text-[#2d251e] md:w-8 md:justify-center md:px-0"
              aria-label="关闭预览"
              title="关闭"
            >
              <span className="md:hidden">
                <BackIcon />
              </span>
              <span className="hidden md:inline">
                <CloseIcon />
              </span>
              <span className="md:hidden">返回</span>
            </button>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium">{artifact.name}</p>
                <span className="shrink-0 rounded border border-[rgba(23,23,23,0.08)] px-1.5 py-0.5 text-[10px] text-[#8a5a37]">
                  {artifactLabel(artifact.kind)}
                </span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[10px] text-[#8e8070]">
                {artifact.path}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {artifact.kind === "html" || artifact.kind === "svg" ? (
              <button
                type="button"
                onClick={() => setShowSource((value) => !value)}
                className="rounded-md border border-[rgba(23,23,23,0.1)] px-2.5 py-1.5 text-xs text-[#6f6257] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626]"
              >
                {shouldShowSource ? "预览" : "源码"}
              </button>
            ) : null}
            <a
              href={downloadUrl}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(23,23,23,0.1)] text-[#6f6257] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626]"
              aria-label={`下载 ${artifact.name}`}
              title="下载"
            >
              <DownloadIcon />
            </a>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-white">
          {shouldShowSource && canReadSource(artifact.kind) ? (
            <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-[#3e3329]">
              {selectedSourceState?.error ?? selectedSourceState?.text ?? "读取中..."}
            </pre>
          ) : artifact.kind === "image" ? (
            <div className="relative min-h-full">
              <Image
                src={previewUrl}
                alt={artifact.name}
                fill
                unoptimized
                sizes="(max-width: 768px) 100vw, 1120px"
                className="object-contain p-4"
              />
            </div>
          ) : artifact.kind === "html" || artifact.kind === "svg" ? (
            <iframe
              src={previewUrl}
              title={artifact.name}
              sandbox=""
              className="h-full min-h-full w-full border-0 bg-white"
            />
          ) : artifact.kind === "pdf" ? (
            <iframe
              src={previewUrl}
              title={artifact.name}
              className="h-full min-h-full w-full border-0 bg-white"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[#7f7468]">
              当前类型暂不支持内嵌预览，请下载查看。
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return <BodyPortal>{previewDialog}</BodyPortal>;
}

export function ArtifactPopover({
  conversationId,
  artifacts,
  open,
  onOpenChange,
}: ArtifactPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(null);
  const previewArtifact = useMemo(() => {
    return (
      artifacts.find((artifact) => artifact.id === previewArtifactId) ?? null
    );
  }, [artifacts, previewArtifactId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={popoverId}
        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition sm:px-2.5 ${
          artifacts.length > 0
            ? "border-[rgba(201,106,43,0.28)] bg-[rgba(201,106,43,0.08)] text-[#8b4317] hover:border-[rgba(201,106,43,0.45)] hover:text-[#6f320f]"
            : "border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.48)] text-[#776b60] hover:border-[rgba(23,23,23,0.16)] hover:text-[#3f352c]"
        }`}
        title="查看会话 artifacts"
      >
        <ArtifactIcon />
        <span className="hidden sm:inline">Artifacts</span>
        <span className="font-mono">{artifacts.length}</span>
      </button>

      {open ? (
        <div
          id={popoverId}
          className="menu-appear fixed left-3 right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-50 overflow-hidden rounded-xl border border-[rgba(23,23,23,0.1)] bg-white text-[#3b3027] shadow-lg shadow-black/8 md:absolute md:left-auto md:right-0 md:top-[calc(100%+0.5rem)] md:w-[24rem]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[rgba(23,23,23,0.06)] px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[#978b7e]">
              会话 Artifacts
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[#b0a496]">
              {artifacts.length}
            </span>
          </div>

          {artifacts.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-h-[min(62vh,27rem)] overflow-y-auto py-1 md:max-h-[340px]">
              {artifacts.map((artifact) => {
                const downloadUrl = artifactUrl(conversationId, artifact.id, true);

                return (
                  <div
                    key={artifact.id}
                    className="flex w-full items-start gap-2.5 px-3 py-1.5 transition hover:bg-[rgba(201,106,43,0.06)]"
                  >
                    <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#9c5626]">
                      <ArtifactIcon />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-[12px] text-[#352d25]">
                          {artifact.name}
                        </span>
                        <span className="shrink-0 rounded-full bg-[rgba(201,106,43,0.1)] px-1.5 py-0.5 text-[10px] leading-none text-[#9c5626]">
                          {artifactLabel(artifact.kind)}
                        </span>
                      </div>
                      <p
                        className="mt-0.5 truncate text-[11px] leading-4 text-[#9e9285]"
                        title={artifact.path}
                      >
                        {artifact.path}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] leading-4 text-[#b0a496]">
                        {formatBytes(artifact.sizeBytes)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewArtifactId(artifact.id);
                          onOpenChange(false);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8c8175] transition hover:bg-[rgba(201,106,43,0.08)] hover:text-[#9c5626]"
                        aria-label={`预览 ${artifact.name}`}
                        title="预览"
                      >
                        <PreviewIcon />
                      </button>
                      <a
                        href={downloadUrl}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8c8175] transition hover:bg-[rgba(201,106,43,0.08)] hover:text-[#9c5626]"
                        aria-label={`下载 ${artifact.name}`}
                        title="下载"
                      >
                        <DownloadIcon />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {artifacts.length > 0 ? (
            <div className="border-t border-[rgba(23,23,23,0.06)] px-3 py-1.5 text-[10px] leading-4 text-[#b0a496]">
              预览会在当前页面打开，下载保留原文件
            </div>
          ) : null}
        </div>
      ) : null}

      {previewArtifact ? (
        <ArtifactPreview
          key={previewArtifact.id}
          artifact={previewArtifact}
          conversationId={conversationId}
          onClose={() => setPreviewArtifactId(null)}
        />
      ) : null}
    </div>
  );
}
