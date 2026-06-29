"use client";

import { sanitizeFontStack } from "@/lib/provider-config";

type FontSettingsProps = {
  fontSans: string;
  fontMono: string;
  onChange: (next: { fontSans?: string; fontMono?: string }) => void;
  onSave: () => void;
  isSaving: boolean;
  saveMessage: { type: "success" | "error"; text: string } | null;
};

// Build an inline-style font-family list from user input. sanitizeFontStack
// returns an already-quoted list (or "" if nothing valid), so illegal input
// collapses to just the stack var and the preview matches the saved result.
function previewFamily(value: string, stackVar: string): string {
  const safe = sanitizeFontStack(value);
  return safe ? `${safe}, ${stackVar}` : stackVar;
}

const PREVIEW_TEXT = "敏捷的棕色狐狸 The quick brown fox 0123456789";

const inputClass =
  "mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-sm text-foreground outline-none transition focus:border-primary";
const previewClass =
  "mt-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-3 leading-7 text-foreground";

export function FontSettings({
  fontSans,
  fontMono,
  onChange,
  onSave,
  isSaving,
  saveMessage,
}: FontSettingsProps) {
  return (
    <section className="mt-10 max-w-2xl">
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">字体</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          填写字体名覆盖默认正文 / 等宽字体，可填多个、用逗号分隔（如 Inter, PingFang SC），引号可选。
          保存在服务端、跨设备生效；需本机已安装方可生效，否则按填写顺序回退、最后回退默认。留空即用默认。
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="font-sans" className="block text-sm font-medium text-foreground">
            正文字体
          </label>
          <input
            id="font-sans"
            type="text"
            value={fontSans}
            onChange={(event) => onChange({ fontSans: event.target.value })}
            placeholder="留空 = 默认。可填多个，如 Inter, PingFang SC"
            className={inputClass}
          />
          <p
            className={`${previewClass} text-[15px]`}
            style={{ fontFamily: previewFamily(fontSans, "var(--font-sans-stack)") }}
          >
            {PREVIEW_TEXT}
          </p>
        </div>

        <div>
          <label htmlFor="font-mono" className="block text-sm font-medium text-foreground">
            等宽字体
          </label>
          <input
            id="font-mono"
            type="text"
            value={fontMono}
            onChange={(event) => onChange({ fontMono: event.target.value })}
            placeholder="留空 = 默认。可填多个，如 JetBrains Mono, 微软雅黑"
            className={inputClass}
          />
          <p
            className={`${previewClass} text-[13px]`}
            style={{ fontFamily: previewFamily(fontMono, "var(--font-mono-stack)") }}
          >
            {PREVIEW_TEXT}
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-3 border-t border-[var(--border)] pt-5">
        {saveMessage && (
          <span
            className={`text-xs ${
              saveMessage.type === "success" ? "text-[var(--success)]" : "text-[var(--danger)]"
            }`}
          >
            {saveMessage.text}
          </span>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="rounded-full bg-foreground px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-primary-foreground transition hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          {isSaving ? "保存中..." : "保存"}
        </button>
      </div>
    </section>
  );
}
