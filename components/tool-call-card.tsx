type ToolInvocation = {
  type: string;
  toolName?: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

function formatJson(value: unknown) {
  if (value === undefined) {
    return "暂无";
  }

  return JSON.stringify(value, null, 2);
}

function toToolName(invocation: ToolInvocation) {
  if (invocation.type === "dynamic-tool") {
    return invocation.toolName ?? "unknown_tool";
  }

  return invocation.type.replace(/^tool-/, "");
}

function stateLabel(state: string) {
  switch (state) {
    case "input-streaming":
      return "参数生成中";
    case "input-available":
      return "参数已生成";
    case "output-available":
      return "执行完成";
    case "output-error":
      return "执行失败";
    case "output-denied":
      return "执行被拒绝";
    case "approval-requested":
      return "等待批准";
    case "approval-responded":
      return "已响应批准";
    default:
      return state;
  }
}

export function ToolCallCard({ invocation }: { invocation: ToolInvocation }) {
  const toolName = toToolName(invocation);
  const failed = invocation.state === "output-error";

  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-orange-700">
            {toolName}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-900">
            Tool Call #{invocation.toolCallId.slice(0, 8)}
          </p>
        </div>

        <span
          className={`rounded-md px-3 py-1 text-xs font-medium ${
            failed
              ? "bg-red-100 text-red-700"
              : "bg-emerald-100 text-emerald-700"
          }`}
        >
          {stateLabel(invocation.state)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg bg-stone-50 p-3">
          <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">
            Input
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-6 text-slate-700">
            {formatJson(invocation.input)}
          </pre>
        </div>

        <div className="rounded-lg bg-stone-50 p-3">
          <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">
            Output
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-6 text-slate-700">
            {failed ? invocation.errorText : formatJson(invocation.output)}
          </pre>
        </div>
      </div>
    </section>
  );
}
