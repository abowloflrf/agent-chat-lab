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
        <div className="mb-4 rounded-[12px] border border-[rgba(23,23,23,0.08)] bg-white/80 px-3.5 py-2.5 text-[12px] leading-5 text-[#36643a]">
          ✓ 已选择：{parsedOutput.answer}
        </div>
      );
    }

    if (parsedOutput.outcome === "free_text") {
      return (
        <div className="mb-4 rounded-[12px] border border-[rgba(23,23,23,0.08)] bg-white/80 px-3.5 py-2.5 text-[12px] leading-5 text-[#36643a]">
          ✓ 已回答：{parsedOutput.answer}
        </div>
      );
    }

    return (
      <div className="mb-4 rounded-[12px] border border-[rgba(23,23,23,0.08)] bg-white/80 px-3.5 py-2.5 text-[12px] leading-5 text-[#8e8070]">
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
      <div className="mb-4 rounded-[12px] border border-[rgba(23,23,23,0.08)] bg-white/80 px-3.5 py-2.5 text-[12px] leading-5 text-[#8e8070]">
        此提问已失效（未作答）
      </div>
    );
  }

  const submit = (answer: AskUserQuestionOutput) => {
    if (submitting) {
      return;
    }

    setSubmitting(true);
    void onAnswer?.(toolCallId, answer);
  };

  // 退化输入（无选项且禁用自由输入）时强制显示输入框，避免只剩跳过的死局。
  const showFreeText = parsedInput.allowFreeText || parsedInput.options.length === 0;
  const canSubmitFreeText = freeText.trim().length > 0 && !submitting;

  return (
    <div className="mb-4 rounded-[12px] border border-[rgba(23,23,23,0.08)] bg-white/80 p-3.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
        需要你确认
      </p>
      <p className="mt-1.5 text-[13px] font-medium leading-6 text-[#282019]">
        {parsedInput.question}
      </p>

      {parsedInput.options.length > 0 ? (
        <div className="mt-3 space-y-2">
          {parsedInput.options.map((option) => (
            <button
              key={option.label}
              type="button"
              disabled={submitting}
              onClick={() => submit(buildSelectedOptionOutput(option.label))}
              className="block w-full rounded-[10px] border border-[rgba(23,23,23,0.14)] px-3.5 py-2.5 text-left transition hover:border-[rgba(201,106,43,0.35)] hover:bg-[rgba(255,248,241,0.9)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block text-[13px] leading-5 text-[#282019]">
                {option.label}
              </span>
              {option.description ? (
                <span className="mt-0.5 block text-[12px] leading-5 text-[#8e8070]">
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
                submit(buildFreeTextOutput(freeText.trim()));
              }
            }}
            placeholder="输入你的回答…"
            className="min-w-0 flex-1 rounded-full border border-[rgba(23,23,23,0.14)] bg-white px-4 py-2 text-[13px] text-[#282019] placeholder:text-[#b8afa6] focus:border-[rgba(201,106,43,0.45)] focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={!canSubmitFreeText}
            onClick={() => submit(buildFreeTextOutput(freeText.trim()))}
            className="flex-shrink-0 rounded-full bg-[#171717] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white transition hover:bg-[#2b241d] disabled:cursor-not-allowed disabled:bg-[#b8afa6]"
          >
            回复
          </button>
        </div>
      ) : null}

      <div className="mt-3">
        <button
          type="button"
          disabled={submitting}
          onClick={() => submit(buildSkippedOutput())}
          className="rounded-full border border-[rgba(23,23,23,0.14)] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#4a4138] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626] disabled:cursor-not-allowed disabled:opacity-50"
        >
          跳过，让助手自行判断
        </button>
      </div>
    </div>
  );
}
