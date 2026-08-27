"use client";

import type { KeyboardEvent, RefObject, SyntheticEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { MAX_TEXTAREA_ROWS, MIN_TEXTAREA_ROWS } from "@/lib/constants";
import { useSpeechRecognition } from "@/components/use-speech-recognition";
import {
  ModelSelector,
  type ModelSelection,
} from "@/components/model-selector";
import {
  SessionToolSelector,
  type SessionToolItem,
} from "@/components/session-tool-selector";
import type { ProviderSettings } from "@/lib/provider-config";

function McpIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <rect x="2" y="3" width="20" height="7" rx="2" />
      <rect x="2" y="14" width="20" height="7" rx="2" />
      <path d="M6 6.5h.01M6 17.5h.01" />
    </svg>
  );
}

function SkillsIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M12 3l1.9 4.7L18.5 9.5l-4.6 1.8L12 16l-1.9-4.7L5.5 9.5l4.6-1.8z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
    </svg>
  );
}

function voiceErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "麦克风权限被拒绝";
    case "no-speech":
      return "没有听到声音";
    case "audio-capture":
      return "未检测到麦克风";
    case "network":
      return "浏览器语音识别服务连接失败";
    case "start-failed":
      return "语音识别启动失败，请检查浏览器权限";
    default:
      return "语音识别出错";
  }
}

/**
 * Build the neutral-centred RGB displacement map used by the composer's SVG
 * backdrop filter. The blurred inner rect keeps the textarea readable while
 * the gradients leave stronger refraction around the rounded edge.
 */
function buildComposerGlassMap(width: number, height: number): string {
  const radius = Math.min(28, Math.round(height / 2));
  const inset = Math.min(width, height) * 0.055;
  const innerWidth = Math.max(1, width - inset * 2);
  const innerHeight = Math.max(1, height - inset * 2);
  const svg =
    `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">` +
    "<defs>" +
    '<linearGradient id="red" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="red"/></linearGradient>' +
    '<linearGradient id="blue" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="blue"/></linearGradient>' +
    "</defs>" +
    `<rect width="${width}" height="${height}" fill="black"/>` +
    `<rect width="${width}" height="${height}" rx="${radius}" fill="url(#red)"/>` +
    `<rect width="${width}" height="${height}" rx="${radius}" fill="url(#blue)" style="mix-blend-mode:difference"/>` +
    `<rect x="${inset}" y="${inset}" width="${innerWidth}" height="${innerHeight}" rx="${radius}" fill="hsl(0 0% 50% / .92)" style="filter:blur(12px)"/>` +
    "</svg>";

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * 底部输入区表单：textarea + 模型/MCP/Skills 选择 + 发送/停止按钮。textareaRef 由
 * ChatShell 持有（其 [draft] 依赖的自适应高度 effect 操作它），此处透传给 <textarea>。
 * onDraftChange/onSelectModel 等回调由 ChatShell 直传其 setter（不在此包装），以保留
 * 逐字符增高与"仅用户显式选模型时写 store"的语义。外层 composer 容器（含中断横幅）
 * 留在 ChatShell。
 */
export function ChatComposer({
  onSubmit,
  textareaRef,
  draft,
  onDraftChange,
  onKeyDown,
  providers,
  selectedModel,
  onSelectModel,
  mcpServerItems,
  selectedMcpServerIds,
  onChangeMcpServerIds,
  skillItems,
  selectedSkillNames,
  onChangeSkillNames,
  isBusy,
  isSubmitting,
  onStop,
}: {
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  onDraftChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  providers: ProviderSettings[];
  selectedModel: ModelSelection | null;
  onSelectModel: (selection: ModelSelection) => void;
  mcpServerItems: SessionToolItem[];
  selectedMcpServerIds: string[];
  onChangeMcpServerIds: (selectedIds: string[]) => void;
  skillItems: SessionToolItem[];
  selectedSkillNames: string[];
  onChangeSkillNames: (selectedIds: string[]) => void;
  isBusy: boolean;
  isSubmitting: boolean;
  onStop: () => void | Promise<void>;
}) {
  // Draft content captured when recording starts; transcript is appended onto it.
  const baseRef = useRef("");
  const glassRef = useRef<HTMLDivElement>(null);
  const glassMapRef = useRef<SVGFEImageElement>(null);
  const glassFilterId = `composer-liquid-glass-${useId().replace(/:/g, "")}`;
  const [glassVariant, setGlassVariant] = useState<"frosted" | "refracted">(
    "frosted",
  );
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const { supported, listening, start, stop, abort } = useSpeechRecognition({
    onResult: (text) => onDraftChange(baseRef.current + text),
    onError: (code) => setVoiceError(voiceErrorMessage(code)),
  });
  useEffect(() => {
    if (isBusy && listening) {
      abort();
    }
  }, [abort, isBusy, listening]);
  useEffect(() => {
    const glass = glassRef.current;
    const map = glassMapRef.current;
    if (!glass || !map) return;

    // SVG references inside backdrop-filter currently render reliably only in
    // Chromium. Safari/WebKit accepts ordinary blur/saturate functions but does
    // not paint the referenced displacement filter, so send it to the explicit
    // frosted fallback instead of leaving a visually inert url() declaration.
    const isChromium = /(?:Chrome|Chromium|Edg|OPR)\//.test(
      window.navigator.userAgent,
    );
    const canUseSvgBackdrop =
      isChromium &&
      window.CSS?.supports(
        "backdrop-filter",
        `url(#${glassFilterId}) blur(1px)`,
      );
    if (!canUseSvgBackdrop) {
      return;
    }

    const syncMap = () => {
      const rect = glass.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const uri = buildComposerGlassMap(width, height);
      map.setAttribute("href", uri);
      map.setAttributeNS("http://www.w3.org/1999/xlink", "href", uri);
      setGlassVariant("refracted");
    };

    let mapTimer = 0;
    const scheduleMap = () => {
      window.clearTimeout(mapTimer);
      mapTimer = window.setTimeout(syncMap, 140);
    };

    syncMap();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleMap);
    observer?.observe(glass);
    window.addEventListener("resize", scheduleMap, { passive: true });

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", scheduleMap);
      window.clearTimeout(mapTimer);
    };
  }, [glassFilterId]);
  const startVoice = () => {
    baseRef.current = draft.trim().length > 0 ? draft : "";
    setVoiceError(null);
    start();
  };
  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    if (listening) {
      event.preventDefault();
      stop();
      return;
    }
    onSubmit(event);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      listening &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      stop();
      return;
    }
    onKeyDown(event);
  };
  const isEmpty = draft.trim().length === 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="composer-glass-wrap pointer-events-auto"
    >
      <div
        ref={glassRef}
        className="composer-liquid-glass"
        data-glass-variant={glassVariant}
        style={
          glassVariant === "refracted"
            ? {
                backdropFilter: `url(#${glassFilterId}) blur(8px) saturate(1.55)`,
              }
            : undefined
        }
      >
        <label className="block">
          <span className="sr-only">输入消息</span>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              if (voiceError) setVoiceError(null);
              onDraftChange(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            rows={MIN_TEXTAREA_ROWS}
            className="w-full resize-none field-sizing-content overflow-y-auto bg-transparent px-3.5 pb-1.5 pt-3 text-[15px] leading-7 text-foreground outline-none placeholder:text-muted-foreground lg:px-4"
            style={{
              minHeight: `calc(${MIN_TEXTAREA_ROWS}lh + 1.125rem)`,
              maxHeight: `calc(${MAX_TEXTAREA_ROWS}lh + 1.125rem)`,
            }}
          />
        </label>

        <div className="flex items-center justify-between gap-2 px-2 pb-2 lg:px-2.5 lg:pb-2.5">
          <div className="flex min-w-0 items-center gap-1">
            <ModelSelector
              providers={providers}
              selected={selectedModel}
              onSelect={onSelectModel}
              disabled={isBusy || isSubmitting}
            />
            <SessionToolSelector
              label="MCP"
              icon={<McpIcon />}
              items={mcpServerItems}
              selectedIds={selectedMcpServerIds}
              onChange={onChangeMcpServerIds}
              disabled={isBusy || isSubmitting}
              emptyHint="本次对话不会连接任何 MCP 服务"
            />
            <SessionToolSelector
              label="Skills"
              icon={<SkillsIcon />}
              items={skillItems}
              selectedIds={selectedSkillNames}
              onChange={onChangeSkillNames}
              disabled={isBusy || isSubmitting}
              emptyHint="本次对话不会加载任何 Skill"
            />
            <span
              className={`ml-1 hidden truncate text-[11px] lg:inline ${
                voiceError ? "text-red-500" : "text-muted-foreground"
              }`}
            >
              {listening
                ? "正在聆听… 再次点击结束"
                : voiceError
                  ? voiceError
                  : "Enter 发送 · Shift+Enter 换行"}
            </span>
          </div>
          {isBusy ? (
            <button
              type="button"
              onClick={() => void onStop()}
              title="停止生成"
              aria-label="停止生成"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-primary-foreground transition hover:bg-[var(--accent-strong)] animate-[pulse-ring_2s_ease-in-out_infinite]"
            >
              <svg className="animate-[square-breathe_2s_ease-in-out_infinite]" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
            </button>
          ) : listening ? (
            <button
              type="button"
              onClick={stop}
              title="停止录音"
              aria-label="停止录音"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500 text-white transition hover:bg-red-600 animate-[pulse-ring_2s_ease-in-out_infinite]"
            >
              <MicIcon />
            </button>
          ) : supported && isEmpty ? (
            <button
              type="button"
              onClick={startVoice}
              title="语音输入"
              aria-label="语音输入"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-primary-foreground transition-colors duration-200 hover:bg-[var(--accent-strong)]"
            >
              <MicIcon />
            </button>
          ) : (
            <button
              type="submit"
              disabled={isEmpty || isSubmitting}
              title="发送消息"
              aria-label="发送消息"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-primary-foreground transition-colors duration-200 hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-muted-foreground"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3M4 7l4-4 4 4" /></svg>
            </button>
          )}
        </div>
        {voiceError ? (
          <p className="px-3 pb-2 text-xs text-red-500 lg:hidden">
            {voiceError}
          </p>
        ) : null}
      </div>
      <svg
        className="composer-glass-defs"
        aria-hidden="true"
        focusable="false"
        width="0"
        height="0"
      >
        <defs>
          <filter id={glassFilterId} colorInterpolationFilters="sRGB">
            <feImage
              ref={glassMapRef}
              x="0"
              y="0"
              width="100%"
              height="100%"
              preserveAspectRatio="none"
              result="map"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              xChannelSelector="R"
              yChannelSelector="B"
              scale="-44"
              result="displacedRed"
            />
            <feColorMatrix
              in="displacedRed"
              type="matrix"
              values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"
              result="red"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              xChannelSelector="R"
              yChannelSelector="B"
              scale="-41"
              result="displacedGreen"
            />
            <feColorMatrix
              in="displacedGreen"
              type="matrix"
              values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0"
              result="green"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              xChannelSelector="R"
              yChannelSelector="B"
              scale="-38"
              result="displacedBlue"
            />
            <feColorMatrix
              in="displacedBlue"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0"
              result="blue"
            />
            <feBlend in="red" in2="green" mode="screen" result="redGreen" />
            <feBlend in="redGreen" in2="blue" mode="screen" result="color" />
            <feGaussianBlur in="color" stdDeviation="0.65" />
          </filter>
        </defs>
      </svg>
    </form>
  );
}
