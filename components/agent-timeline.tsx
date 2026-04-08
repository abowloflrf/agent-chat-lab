import type { AgentObservability } from "@/lib/observability";

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  const seconds = durationMs / 1000;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour12: false,
  });
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
  return (
    <section className="rounded-[18px] border border-[rgba(23,23,23,0.08)] bg-[rgba(248,242,235,0.8)] p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8e8070]">
            Agent Timeline
          </p>
          <p className="mt-1 text-sm text-[#2e251c]">
            {observability.timeline.length} 步
            {observability.totalDurationMs !== undefined
              ? ` · ${formatDuration(observability.totalDurationMs)}`
              : ""}
          </p>
        </div>

        <span
          className={`w-fit rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] ${
            observability.status === "finished"
              ? "bg-[#e7f4e5] text-[#36643a]"
              : "bg-[#f5e5c8] text-[#93591d]"
          }`}
        >
          {observability.status === "finished" ? "完成" : "运行中"}
        </span>
      </div>

      {observability.timeline.length === 0 ? (
        <p className="mt-4 border-t border-[rgba(23,23,23,0.08)] pt-4 text-sm text-[#6d6257]">
          等待下一步执行记录...
        </p>
      ) : (
        <div className="mt-4 space-y-4 border-t border-[rgba(23,23,23,0.08)] pt-4">
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
                    {step.provider} · {formatTime(step.startedAt)}
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

              <div className="mt-3 rounded-[14px] bg-white px-4 py-3 text-sm leading-6 text-[#53483d]">
                {formatPreview(step.text)}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
