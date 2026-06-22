"use client";

import { useState } from "react";
import {
  buildFreeTextOutput,
  buildSelectedOptionOutput,
  buildSkippedOutput,
  parseAskUserQuestionInput,
  parseAskUserQuestionOutput,
  type AskUserQuestionOutput,
} from "@/lib/ai/ask-user-question";

export function AskUserQuestionPanel({
  input,
  output,
  state,
  toolCallId,
  interactive,
  onAnswer,
}: {
  input: unknown;
  output: unknown;
  state: string;
  toolCallId: string;
  interactive: boolean;
  onAnswer?: (
    toolCallId: string,
    output: AskUserQuestionOutput,
  ) => Promise<void> | void;
}) {
  const [freeText, setFreeText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (state === "output-available") {
    const parsedOutput = parseAskUserQuestionOutput(output);

    if (!parsedOutput) {
      return null;
    }

    if (parsedOutput.outcome === "selected_option") {
      return (
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-[12px] leading-5 text-[var(--foreground)]">
          ✓ 已选择：{parsedOutput.answer}
        </div>
      );
    }

    if (parsedOutput.outcome === "free_text") {
      return (
        <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-[12px] leading-5 text-[var(--foreground)]">
          ✓ 已回答：{parsedOutput.answer}
        </div>
      );
    }

    return (
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-[12px] leading-5 text-[var(--muted-foreground)]">
        {parsedOutput.outcome === "skipped"
          ? "用户跳过了此问题"
          : "未作答（用户已另行回复）"}
      </div>
    );
  }

  if (state !== "input-available") {
    return null;
  }

  const parsedInput = parseAskUserQuestionInput(input);

  if (!parsedInput) {
    return null;
  }

  if (!interactive) {
    return (
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-3.5 py-2.5 text-[12px] leading-5 text-[var(--muted-foreground)]">
        此提问已失效（未作答）
      </div>
    );
  }

  const submit = async (answer: AskUserQuestionOutput) => {
    if (submitting) {
      return;
    }

    setSubmitting(true);
    try {
      await onAnswer?.(toolCallId, answer);
    } finally {
      // 正常路径下回答已写入、面板切换为已答分支；这里复位是为了
      // onAnswer 提前返回或失败时按钮不至于永久禁用。
      setSubmitting(false);
    }
  };

  // 退化输入（无选项且禁用自由输入）时强制显示输入框，避免只剩跳过的死局。
  const showFreeText = parsedInput.allowFreeText || parsedInput.options.length === 0;
  const canSubmitFreeText = freeText.trim().length > 0 && !submitting;

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
        需要你确认
      </p>
      <p className="mt-1.5 text-[13px] font-medium leading-6 text-[var(--foreground)]">
        {parsedInput.question}
      </p>

      {parsedInput.options.length > 0 ? (
        <div className="mt-3 space-y-2">
          {parsedInput.options.map((option, index) => (
            <button
              key={`${index}-${option.label}`}
              type="button"
              disabled={submitting}
              onClick={() => void submit(buildSelectedOptionOutput(option.label))}
              className="block w-full rounded-[10px] border border-[var(--border)] px-3.5 py-2.5 text-left transition hover:border-[var(--accent)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block text-[13px] leading-5 text-[var(--foreground)]">
                {option.label}
              </span>
              {option.description ? (
                <span className="mt-0.5 block text-[12px] leading-5 text-[var(--muted-foreground)]">
                  {option.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {showFreeText ? (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={freeText}
            disabled={submitting}
            onChange={(event) => setFreeText(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing &&
                canSubmitFreeText
              ) {
                void submit(buildFreeTextOutput(freeText.trim()));
              }
            }}
            placeholder="输入你的回答…"
            className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--glass-bg)] px-4 py-2 text-[13px] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={!canSubmitFreeText}
            onClick={() => void submit(buildFreeTextOutput(freeText.trim()))}
            className="flex-shrink-0 rounded-full bg-foreground px-4 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-primary-foreground transition hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-muted-foreground"
          >
            回复
          </button>
        </div>
      ) : null}

      <div className="mt-3">
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit(buildSkippedOutput())}
          className="rounded-full border border-[var(--border)] px-4 py-2 text-[11px] font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          跳过，让助手自行判断
        </button>
      </div>
    </div>
  );
}
