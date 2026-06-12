"use client";

import { useState } from "react";
import type { AgentObservability } from "@/lib/observability";
import { formatClockTime } from "@/lib/datetime";
import { formatTokenCount } from "@/lib/format";

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
}

function formatPreview(text: string) {
  const normalized = text.trim();

  if (!normalized) {
    return "本步没有直接输出文本，主要用于发起或收束工具调用。";
  }

  return normalized.length > 180
    ? `${normalized.slice(0, 180).trimEnd()}...`
    : normalized;
}

type AgentTimelineProps = {
  observability: AgentObservability;
};

/**
 * 执行过程摘要：折叠态是一行低调的文本触发器（不再是整宽卡片），
 * 点击展开逐步明细。
 */
export function AgentTimeline({ observability }: AgentTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = observability.status !== "finished";

  const totalInputTokens = observability.timeline.reduce(
    (sum, step) => sum + step.usage.inputTokens,
    0,
  );
  const totalOutputTokens = observability.timeline.reduce(
    (sum, step) => sum + step.usage.outputTokens,
    0,
  );
  const totalToolCalls = observability.timeline.reduce(
    (sum, step) => sum + step.toolCalls.length,
    0,
  );

  const summaryText =
    observability.timeline.length === 0
      ? isRunning
        ? "执行中…"
        : "无执行记录"
      : [
          `${observability.timeline.length} 步`,
          totalToolCalls > 0 ? `${totalToolCalls} 次工具调用` : null,
          observability.totalDurationMs !== undefined
            ? formatDuration(observability.totalDurationMs)
            : null,
          `${formatTokenCount(totalInputTokens + totalOutputTokens)} tokens`,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div>
      {/* Inline trigger */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={`-mx-2 flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[11px] transition-colors hover:bg-[rgba(201,106,43,0.06)] ${
          isRunning ? "text-[#9a5b05]" : "text-[#6d6257] hover:text-[#9c5626]"
        }`}
      >
        {isRunning ? (
          <svg
            className="tool-spin h-3 w-3 flex-shrink-0"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="28.27"
              strokeDashoffset="8"
              opacity="0.8"
            />
          </svg>
        ) : (
          <svg
            className="h-3 w-3 flex-shrink-0"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M2 3h12M2 6.5h12M2 10h8M2 13.5h10"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        )}
        <span className="font-mono">{summaryText}</span>
        <svg
          className={`h-3 w-3 flex-shrink-0 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Expanded step details */}
      {expanded ? (
        <div className="mt-2 rounded-[14px] border border-[rgba(23,23,23,0.08)] bg-[rgba(248,242,235,0.8)] px-4 pb-4 pt-3">
          {observability.timeline.length === 0 ? (
            <p className="text-sm text-[#6d6257]">等待下一步执行记录...</p>
          ) : (
            <div className="space-y-4">
              {observability.timeline.map((step) => (
                <article
                  key={`${step.event}-${step.stepNumber}-${step.finishedAt}`}
                  className="border-t border-[rgba(23,23,23,0.08)] pt-4 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-[#a44d16]">
                          Step {step.stepNumber + 1}
                        </span>
                        <span className="rounded-full bg-[rgba(23,23,23,0.05)] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[#6b6157]">
                          {step.event}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[#7a6e62]">
                        {step.provider} · {formatClockTime(step.startedAt)}
                      </p>
                    </div>

                    <div className="text-left md:text-right">
                      <p className="text-sm text-[#2b231b]">
                        {formatDuration(step.durationMs)}
                      </p>
                      <p className="text-xs text-[#7a6e62]">{step.finishReason}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#584d43]">
                    <span className="rounded-full bg-white px-2.5 py-1">
                      In {step.usage.inputTokens}
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1">
                      Out {step.usage.outputTokens}
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1">
                      Total {step.usage.totalTokens}
                    </span>
                    {step.usage.reasoningTokens > 0 ? (
                      <span className="rounded-full bg-white px-2.5 py-1">
                        Reasoning {step.usage.reasoningTokens}
                      </span>
                    ) : null}
                    {step.usage.cachedInputTokens > 0 ? (
                      <span className="rounded-full bg-white px-2.5 py-1">
                        Cache {step.usage.cachedInputTokens}
                      </span>
                    ) : null}
                  </div>

                  {step.toolCalls.length > 0 ? (
                    <div className="mt-3">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
                        Tools
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {step.toolCalls.map((toolCall) => (
                          <span
                            key={toolCall.toolCallId}
                            className="rounded-full bg-[rgba(201,106,43,0.12)] px-2.5 py-1 font-mono text-[11px] text-[#9c5626]"
                          >
                            {toolCall.toolName}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 rounded-[10px] bg-white px-4 py-3 text-sm leading-6 text-[#53483d]">
                    {formatPreview(step.text)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
