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

  return (
    <section
      className={`overflow-hidden rounded-[14px] border transition-colors duration-200 ${
        isRunning
          ? "border-[rgba(201,106,43,0.25)] bg-[rgba(248,242,235,0.9)]"
          : "border-[rgba(23,23,23,0.08)] bg-[rgba(248,242,235,0.8)]"
      }`}
    >
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[rgba(201,106,43,0.04)]"
      >
        {/* Left status bar */}
        <div
          className={`h-7 w-[3px] flex-shrink-0 rounded-full ${
            isRunning ? "tool-running-bar" : "bg-[#36643a]"
          }`}
        />

        {/* Icon */}
        {isRunning ? (
          <svg
            className="tool-spin h-3.5 w-3.5 flex-shrink-0 text-[#c96a2b]"
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
          <svg className="h-3.5 w-3.5 flex-shrink-0 text-[#8e8070]" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 3h12M2 6.5h12M2 10h8M2 13.5h10"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        )}

        {/* Label */}
        <span className="flex-shrink-0 text-[11px] font-medium uppercase tracking-[0.15em] text-[#8e8070]">
          Timeline
        </span>

        {/* Summary stats */}
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#8e8070]">
          {observability.timeline.length} 步
          {totalToolCalls > 0 ? ` · ${totalToolCalls} 次工具调用` : ""}
          {observability.totalDurationMs !== undefined
            ? ` · ${formatDuration(observability.totalDurationMs)}`
            : ""}
          {" · "}
          {formatTokenCount(totalInputTokens + totalOutputTokens)} tokens
        </span>

        {/* Status badge */}
        <span
          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${
            isRunning
              ? "tool-running-indicator bg-[#fff7ed] text-[#9a5b05]"
              : "bg-[#e7f4e5] text-[#36643a]"
          }`}
        >
          {isRunning ? "运行中" : "完成"}
        </span>

        {/* Chevron */}
        <svg
          className={`h-4 w-4 flex-shrink-0 text-[#8e8070] transition-transform duration-200 ${
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

      {/* Expandable detail section */}
      <div
        className={`grid transition-[grid-template-rows] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-[rgba(23,23,23,0.06)] px-4 pb-4 pt-3">
            {observability.timeline.length === 0 ? (
              <p className="text-sm text-[#6d6257]">
                等待下一步执行记录...
              </p>
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
        </div>
      </div>
    </section>
  );
}
