"use client";

import Image from "next/image";
import {
  useCallback,
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
  onArtifactsChange?: (artifacts: ConversationArtifact[]) => void;
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

function artifactDeleteUrl(
  conversationId: string,
  artifactId: string,
  deleteFile: boolean,
) {
  const base = artifactUrl(conversationId, artifactId);
  return deleteFile ? `${base}?deleteFile=1` : base;
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

function PaperclipIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
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

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M3.8 5.3h12.4M8 5.3V3.9h4v1.4M5.4 5.3l.7 10.1a1.5 1.5 0 0 0 1.5 1.4h4.8a1.5 1.5 0 0 0 1.5-1.4l.7-10.1M8.4 8.3v5.4M11.6 8.3v5.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="px-4 py-7 text-center">
      <p className="text-sm font-medium text-foreground">暂无 Artifacts</p>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
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
      className="fixed inset-0 z-[70] bg-black/[0.28] backdrop-blur-[2px] md:flex md:items-center md:justify-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${artifact.name}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex h-dvh w-full flex-col bg-background text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.22)] md:h-[calc(100dvh-3rem)] md:max-h-[760px] md:w-[min(92vw,1120px)] md:overflow-hidden md:rounded-xl md:border md:border-border">
        <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition hover:bg-[var(--surface-muted)] hover:text-foreground md:w-8 md:justify-center md:px-0"
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
                <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
                  {artifactLabel(artifact.kind)}
                </span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {artifact.path}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {artifact.kind === "html" || artifact.kind === "svg" ? (
              <button
                type="button"
                onClick={() => setShowSource((value) => !value)}
                className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {shouldShowSource ? "预览" : "源码"}
              </button>
            ) : null}
            <a
              href={downloadUrl}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              aria-label={`下载 ${artifact.name}`}
              title="下载"
            >
              <DownloadIcon />
            </a>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto bg-background">
          {shouldShowSource && canReadSource(artifact.kind) ? (
            <pre className="min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-foreground">
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
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
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
  onArtifactsChange,
}: ArtifactPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [previewArtifactId, setPreviewArtifactId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ConversationArtifact | null>(null);
  const [deleteFileChecked, setDeleteFileChecked] = useState(false);
  const [pendingArtifactId, setPendingArtifactId] = useState<string | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const measurePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(384, window.innerWidth - margin * 2);
    const left = Math.max(
      margin,
      Math.min(rect.right - width, window.innerWidth - width - margin),
    );
    const top = rect.bottom + 8;
    setPosition({ top, left, width });
  }, []);
  const previewArtifact = useMemo(() => {
    return (
      artifacts.find((artifact) => artifact.id === previewArtifactId) ?? null
    );
  }, [artifacts, previewArtifactId]);

  const removeArtifact = useCallback(
    async (artifact: ConversationArtifact, deleteFile: boolean) => {
      setPendingArtifactId(artifact.id);
      setArtifactError(null);

      try {
        const response = await fetch(
          artifactDeleteUrl(conversationId, artifact.id, deleteFile),
          { method: "DELETE" },
        );

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(payload?.error ?? "Artifact 操作失败。");
        }

        const payload = (await response.json()) as {
          artifacts?: ConversationArtifact[];
        };
        const nextArtifacts =
          payload.artifacts ?? artifacts.filter((item) => item.id !== artifact.id);

        onArtifactsChange?.(nextArtifacts);
        if (previewArtifactId === artifact.id) {
          setPreviewArtifactId(null);
        }
        setRemoveTarget(null);
        setDeleteFileChecked(false);
      } catch (error) {
        setArtifactError(
          error instanceof Error ? error.message : "Artifact 操作失败。",
        );
      } finally {
        setPendingArtifactId(null);
      }
    },
    [artifacts, conversationId, onArtifactsChange, previewArtifactId],
  );

  const openRemoveDialog = useCallback(
    (artifact: ConversationArtifact) => {
      setRemoveTarget(artifact);
      setDeleteFileChecked(false);
      setArtifactError(null);
      onOpenChange(false);
    },
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      onOpenChange(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }

    function handleReposition() {
      measurePosition();
    }

    measurePosition();
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [measurePosition, onOpenChange, open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) {
            onOpenChange(false);
          } else {
            measurePosition();
            onOpenChange(true);
          }
        }}
        aria-expanded={open}
        aria-controls={popoverId}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition ${
          artifacts.length > 0
            ? "text-[var(--accent)] hover:bg-muted"
            : "text-muted-foreground hover:bg-[var(--surface-muted)]"
        }`}
        title="查看会话 artifacts"
      >
        <PaperclipIcon />
        <span className="font-mono">{artifacts.length}</span>
      </button>

      {open && position ? (
        <BodyPortal>
        <div
          ref={popoverRef}
          id={popoverId}
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
          }}
          className="menu-appear fixed z-[60] overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-lg shadow-black/8"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              会话 Artifacts
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {artifacts.length}
            </span>
          </div>

          {artifacts.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-h-[min(62vh,27rem)] overflow-y-auto py-1 md:max-h-[340px]">
              {artifacts.map((artifact) => {
                const downloadUrl = artifactUrl(conversationId, artifact.id, true);
                const pending = pendingArtifactId === artifact.id;

                return (
                  <div
                    key={artifact.id}
                    className="flex w-full items-start gap-2.5 px-3 py-1.5 transition hover:bg-[var(--surface-muted)]"
                  >
                    <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-[var(--accent)]">
                      <ArtifactIcon />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-[12px] text-foreground">
                          {artifact.name}
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-[var(--accent)]">
                          {artifactLabel(artifact.kind)}
                        </span>
                      </div>
                      <p
                        className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground"
                        title={artifact.path}
                      >
                        {artifact.path}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] leading-4 text-muted-foreground">
                        {formatBytes(artifact.sizeBytes)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setPreviewArtifactId(artifact.id);
                          onOpenChange(false);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-[var(--surface-muted)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45"
                        aria-label={`预览 ${artifact.name}`}
                        title="预览"
                      >
                        <PreviewIcon />
                      </button>
                      <a
                        href={downloadUrl}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-[var(--surface-muted)] hover:text-[var(--accent)]"
                        aria-label={`下载 ${artifact.name}`}
                        title="下载"
                      >
                        <DownloadIcon />
                      </a>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => openRemoveDialog(artifact)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--danger)] transition hover:bg-[var(--danger-surface)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-45"
                        aria-label={`移除 ${artifact.name}`}
                        title="移除"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {artifacts.length > 0 ? (
            <div className="border-t border-border px-3 py-1.5 text-[10px] leading-4 text-muted-foreground">
              {artifactError ?? "预览会在当前页面打开，下载保留原文件"}
            </div>
          ) : null}
        </div>
        </BodyPortal>
      ) : null}

      {previewArtifact ? (
        <ArtifactPreview
          key={previewArtifact.id}
          artifact={previewArtifact}
          conversationId={conversationId}
          onClose={() => setPreviewArtifactId(null)}
        />
      ) : null}

      {removeTarget ? (
        <BodyPortal>
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/[0.28] p-4 backdrop-blur-[2px]"
            role="dialog"
            aria-modal="true"
            aria-label={`移除 ${removeTarget.name}`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !pendingArtifactId) {
                setRemoveTarget(null);
                setDeleteFileChecked(false);
              }
            }}
          >
            <div className="w-full max-w-sm rounded-xl border border-border bg-background p-4 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.22)]">
              <div>
                <p className="text-sm font-semibold">移除 Artifact</p>
                <p className="mt-1 break-words font-mono text-xs leading-5 text-muted-foreground">
                  {removeTarget.path}
                </p>
              </div>

              <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-background p-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={deleteFileChecked}
                  disabled={pendingArtifactId === removeTarget.id}
                  onChange={(event) => setDeleteFileChecked(event.currentTarget.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  同时删除 workspace 中的文件
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                    默认只取消当前会话关联，文件会保留在磁盘上。
                  </span>
                </span>
              </label>

              {artifactError ? (
                <p className="mt-3 text-xs leading-5 text-[var(--danger)]">
                  {artifactError}
                </p>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={pendingArtifactId === removeTarget.id}
                  onClick={() => {
                    setRemoveTarget(null);
                    setDeleteFileChecked(false);
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={pendingArtifactId === removeTarget.id}
                  onClick={() =>
                    void removeArtifact(removeTarget, deleteFileChecked)
                  }
                  className="rounded-md bg-[var(--danger)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {deleteFileChecked ? "移除并删除文件" : "移除关联"}
                </button>
              </div>
            </div>
          </div>
        </BodyPortal>
      ) : null}
    </div>
  );
}
