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
    <section className="rounded-[18px] border border-[rgba(23,23,23,0.08)] bg-[rgba(255,248,241,0.82)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a44d16]">
            {toolName}
          </p>
          <p className="mt-1 text-sm text-[#2f261d]">
            调用 #{invocation.toolCallId.slice(0, 6)}
          </p>
        </div>

        <span
          className={`w-fit rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] ${
            failed
              ? "bg-[#fee2e2] text-[#991b1b]"
              : "bg-[#e7f4e5] text-[#36643a]"
          }`}
        >
          {stateLabel(invocation.state)}
        </span>
      </div>

      <div className="mt-4 grid gap-3 border-t border-[rgba(23,23,23,0.08)] pt-4 md:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
            Input
          </p>
          <pre className="mt-2 overflow-x-auto rounded-[14px] bg-white px-4 py-3 font-mono text-[11px] leading-6 text-[#4b3f35]">
            {formatJson(invocation.input)}
          </pre>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
            Output
          </p>
          <pre className="mt-2 overflow-x-auto rounded-[14px] bg-white px-4 py-3 font-mono text-[11px] leading-6 text-[#4b3f35]">
            {failed ? invocation.errorText : formatJson(invocation.output)}
          </pre>
        </div>
      </div>
    </section>
  );
}
