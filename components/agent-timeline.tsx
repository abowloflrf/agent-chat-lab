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
    <section className="rounded-xl border border-black/10 bg-white/80 p-4 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Agent Timeline
          </p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            {observability.timeline.length} 个 step
            {observability.totalDurationMs !== undefined
              ? ` · 总耗时 ${formatDuration(observability.totalDurationMs)}`
              : " · 运行中"}
          </p>
        </div>

        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            observability.status === "finished"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {observability.status === "finished" ? "已完成" : "观测中"}
        </span>
      </div>

      {observability.timeline.length === 0 ? (
        <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-sm text-slate-600">
          等待第一个 step finish 事件...
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {observability.timeline.map((step) => (
            <article
              key={`${step.event}-${step.stepNumber}-${step.finishedAt}`}
              className="rounded-lg border border-black/10 bg-stone-50 p-4"
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      Step {step.stepNumber + 1}
                    </span>
                    <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-slate-700">
                      {step.event}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-6 text-slate-600">
                    {step.provider} / {step.modelId} · {formatTime(step.startedAt)} -{" "}
                    {formatTime(step.finishedAt)}
                  </p>
                </div>

                <div className="text-left md:text-right">
                  <p className="text-sm font-medium text-slate-900">
                    {formatDuration(step.durationMs)}
                  </p>
                  <p className="text-xs text-slate-600">
                    finish reason: {step.finishReason}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">
                <span className="rounded-full bg-white px-2.5 py-1">
                  Input {step.usage.inputTokens}
                </span>
                <span className="rounded-full bg-white px-2.5 py-1">
                  Output {step.usage.outputTokens}
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
                    Cache Read {step.usage.cachedInputTokens}
                  </span>
                ) : null}
              </div>

              {step.toolCalls.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    Tools
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {step.toolCalls.map((toolCall) => (
                      <span
                        key={toolCall.toolCallId}
                        className="rounded-full bg-orange-100 px-2.5 py-1 font-mono text-xs text-orange-700"
                      >
                        {toolCall.toolName}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 rounded-lg bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                {formatPreview(step.text)}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
