"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  assessBashCommand,
  BASH_TOOL_OUTPUT_LIMIT,
  BASH_TOOL_TIMEOUT_MS,
} from "@/lib/ai/bash-policy";
import {
  isTodoToolName,
  summarizeTodoInput,
  TodoToolPanel,
} from "@/components/todo-tool-card";

type ToolInvocation = {
  type: string;
  toolName?: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: {
    id: string;
    approved?: boolean;
    reason?: string;
  };
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

type ToolStatus = "running" | "success" | "error";

function getToolStatus(state: string): ToolStatus {
  switch (state) {
    case "output-available":
      return "success";
    case "output-error":
    case "output-denied":
      return "error";
    default:
      return "running";
  }
}

function extractBashCommand(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as {
    command?: unknown;
  };

  return typeof record.command === "string" ? record.command : null;
}

function extractInputSummary(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;

  if (toolName === "Bash" && typeof record.command === "string") {
    const cmd = record.command.trim();
    return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
  }

  if (toolName === "WebSearch" && typeof record.query === "string") {
    return record.query;
  }

  if (toolName === "WebFetch" && typeof record.url === "string") {
    return record.url;
  }

  if (isTodoToolName(toolName)) {
    const todoSummary = summarizeTodoInput(toolName, record);

    if (todoSummary) {
      return todoSummary;
    }
  }

  const firstStringValue = Object.values(record).find(
    (v) => typeof v === "string" && v.trim().length > 0,
  ) as string | undefined;

  if (firstStringValue) {
    return firstStringValue.length > 60
      ? firstStringValue.slice(0, 57) + "..."
      : firstStringValue;
  }

  return null;
}

function StatusIcon({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return (
      <svg
        className="tool-spin h-3.5 w-3.5 text-[#c96a2b]"
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
    );
  }

  if (status === "success") {
    return (
      <svg className="h-3.5 w-3.5 text-[#36643a]" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" fill="#e7f4e5" stroke="#36643a" strokeWidth="1" />
        <path
          d="M5 8.2l2 2 4-4.4"
          stroke="#36643a"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg className="h-3.5 w-3.5 text-[#991b1b]" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" fill="#fee2e2" stroke="#991b1b" strokeWidth="1" />
      <path
        d="M5.5 5.5l5 5M10.5 5.5l-5 5"
        stroke="#991b1b"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-[#8e8070] transition-transform duration-200 ${
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
  );
}

function ContentModal({
  title,
  toolCallId,
  content,
  onClose,
}: {
  title: string;
  toolCallId: string;
  content: string;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[rgba(23,23,23,0.08)] px-6 py-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium uppercase tracking-[0.15em] text-[#a44d16]">
              {title}
            </h3>
            <p className="text-[10px] font-mono text-[#8e8070]">
              #{toolCallId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-[#8e8070] transition-colors hover:bg-[rgba(23,23,23,0.08)] hover:text-[#2f261d]"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <pre className="flex-1 overflow-auto p-6 font-mono text-[12px] leading-6 text-[#4b3f35]">
          {content}
        </pre>
      </div>
    </div>,
    document.body,
  );
}

export function ToolCallCard({
  invocation,
  onApprovalResponse,
}: {
  invocation: ToolInvocation;
  onApprovalResponse?: (approvalId: string, approved: boolean) => Promise<void> | void;
}) {
  const toolName = toToolName(invocation);
  const failed = invocation.state === "output-error";
  const status = getToolStatus(invocation.state);
  const isApprovalRequested = invocation.state === "approval-requested";
  const isApprovalResponded = invocation.state === "approval-responded";
  const approvalId = invocation.approval?.id;
  const needsAttention = isApprovalRequested && !!approvalId;

  const [userExpanded, setUserExpanded] = useState(false);
  const expanded = needsAttention || userExpanded;
  const setExpanded = setUserExpanded;
  const [modalOpen, setModalOpen] = useState(false);
  const [modalContent, setModalContent] = useState<{
    title: string;
    content: string;
  } | null>(null);

  const openModal = (title: string, content: string) => {
    setModalContent({ title, content });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setTimeout(() => setModalContent(null), 200);
  };

  const inputContent = formatJson(invocation.input);
  const outputContent = failed
    ? invocation.errorText ?? ""
    : formatJson(invocation.output);
  const bashCommand = toolName === "Bash" ? extractBashCommand(invocation.input) : null;
  const bashAssessment = bashCommand ? assessBashCommand(bashCommand) : null;
  const inputSummary = extractInputSummary(toolName, invocation.input);

  const statusBarColor =
    status === "running"
      ? "tool-running-bar"
      : status === "success"
        ? "bg-[#36643a]"
        : "bg-[#991b1b]";

  const statusBadgeBg =
    status === "running"
      ? "bg-[#fff7ed] text-[#9a5b05]"
      : status === "success"
        ? "bg-[#e7f4e5] text-[#36643a]"
        : "bg-[#fee2e2] text-[#991b1b]";

  return (
    <>
      <section
        className={`overflow-hidden rounded-[14px] border transition-colors duration-200 ${
          status === "running"
            ? "border-[rgba(201,106,43,0.25)] bg-[rgba(255,248,241,0.9)]"
            : status === "error"
              ? "border-[rgba(153,27,27,0.15)] bg-[rgba(255,248,241,0.82)]"
              : "border-[rgba(23,23,23,0.08)] bg-[rgba(255,248,241,0.82)]"
        }`}
      >
        {/* Collapsed header — always visible */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[rgba(201,106,43,0.04)]"
        >
          {/* Left status bar */}
          <div
            className={`h-7 w-[3px] flex-shrink-0 rounded-full ${statusBarColor}`}
          />

          {/* Status icon */}
          <StatusIcon status={status} />

          {/* Tool name */}
          <span className="flex-shrink-0 font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-[#a44d16]">
            {toolName}
          </span>

          {/* Input summary */}
          {inputSummary ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#8e8070]">
              {inputSummary}
            </span>
          ) : (
            <span className="flex-1" />
          )}

          {/* Status badge */}
          <span
            className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${statusBadgeBg} ${
              status === "running" ? "tool-running-indicator" : ""
            }`}
          >
            {stateLabel(invocation.state)}
          </span>

          {/* Chevron */}
          <ChevronIcon expanded={expanded} />
        </button>

        {/* Expandable detail section */}
        <div
          className={`grid transition-[grid-template-rows] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="border-t border-[rgba(23,23,23,0.06)] px-4 pb-4 pt-3">
              {/* Tool call ID */}
              <p className="mb-3 text-[10px] font-mono text-[#8e8070]">
                #{invocation.toolCallId}
              </p>

              {/* Bash-specific assessment */}
              {toolName === "Bash" && bashAssessment ? (
                <div className="mb-4 rounded-[12px] border border-[rgba(23,23,23,0.08)] bg-white/80 p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
                      即将执行
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${
                        bashAssessment.decision === "deny"
                          ? "bg-[#fee2e2] text-[#991b1b]"
                          : bashAssessment.decision === "auto"
                            ? "bg-[#e7f4e5] text-[#36643a]"
                            : "bg-[#fff1d6] text-[#9a5b05]"
                      }`}
                    >
                      {bashAssessment.decision === "deny"
                        ? "高危已拦截"
                        : bashAssessment.decision === "auto"
                          ? "自动执行 · 低风险"
                          : `需审批 · 风险 ${bashAssessment.riskLevel}`}
                    </span>
                  </div>

                  <pre className="mt-3 overflow-x-auto rounded-[10px] bg-[#1f1711] px-4 py-3 font-mono text-[12px] leading-6 text-[#fff4eb]">
                    {bashAssessment.normalizedCommand}
                  </pre>

                  <div className="mt-3 grid gap-3 text-[12px] text-[#4b3f35] md:grid-cols-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
                        Workdir
                      </p>
                      <p className="mt-1 break-all font-mono">{bashAssessment.workdir}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
                        Timeout
                      </p>
                      <p className="mt-1 font-mono">{BASH_TOOL_TIMEOUT_MS}ms</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
                        Output Limit
                      </p>
                      <p className="mt-1 font-mono">{BASH_TOOL_OUTPUT_LIMIT} bytes</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
                      风险说明
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-6 text-[#4b3f35]">
                      {bashAssessment.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>

                  {isApprovalRequested && approvalId ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void onApprovalResponse?.(approvalId, true)}
                        disabled={bashAssessment.decision === "deny"}
                        className="rounded-full bg-[#171717] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white transition hover:bg-[#2b241d] disabled:cursor-not-allowed disabled:bg-[#b8afa6]"
                      >
                        允许执行
                      </button>
                      <button
                        type="button"
                        onClick={() => void onApprovalResponse?.(approvalId, false)}
                        className="rounded-full border border-[rgba(23,23,23,0.14)] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#4a4138] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626]"
                      >
                        拒绝执行
                      </button>
                    </div>
                  ) : null}

                  {isApprovalResponded ? (
                    <p className="mt-4 text-[12px] text-[#6b5b4f]">
                      {invocation.approval?.approved
                        ? "已提交允许执行，等待服务端继续处理。"
                        : "已拒绝执行这条命令。"}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* Non-Bash approval buttons */}
              {toolName !== "Bash" && isApprovalRequested && approvalId ? (
                <div className="mb-4 flex flex-wrap gap-2 border-b border-[rgba(23,23,23,0.08)] pb-4">
                  <button
                    type="button"
                    onClick={() => void onApprovalResponse?.(approvalId, true)}
                    className="rounded-full bg-[#171717] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white transition hover:bg-[#2b241d]"
                  >
                    允许执行
                  </button>
                  <button
                    type="button"
                    onClick={() => void onApprovalResponse?.(approvalId, false)}
                    className="rounded-full border border-[rgba(23,23,23,0.14)] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[#4a4138] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626]"
                  >
                    拒绝执行
                  </button>
                </div>
              ) : null}

              {/* Todo-specific formatted result */}
              {isTodoToolName(toolName) && invocation.state === "output-available" ? (
                <TodoToolPanel toolName={toolName} output={invocation.output} />
              ) : null}

              {/* Input / Output panels */}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
                      Input
                    </p>
                    <button
                      onClick={() => openModal(`${toolName} - Input`, inputContent)}
                      className="text-[10px] uppercase tracking-[0.12em] text-[#a44d16] transition-colors hover:text-[#8b3d0f]"
                    >
                      展开
                    </button>
                  </div>
                  <pre
                    onClick={() => openModal(`${toolName} - Input`, inputContent)}
                    className="mt-2 max-h-48 cursor-pointer overflow-y-auto rounded-[10px] bg-white px-4 py-3 font-mono text-[11px] leading-6 text-[#4b3f35] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] scrollbar-width:none hover:[&::-webkit-scrollbar]:w-2 hover:[&::-webkit-scrollbar]:block"
                  >
                    {inputContent}
                  </pre>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
                      Output
                    </p>
                    <button
                      onClick={() =>
                        openModal(`${toolName} - Output`, outputContent)
                      }
                      className="text-[10px] uppercase tracking-[0.12em] text-[#a44d16] transition-colors hover:text-[#8b3d0f]"
                    >
                      展开
                    </button>
                  </div>
                  <pre
                    onClick={() =>
                      openModal(`${toolName} - Output`, outputContent)
                    }
                    className="mt-2 max-h-48 cursor-pointer overflow-y-auto rounded-[10px] bg-white px-4 py-3 font-mono text-[11px] leading-6 text-[#4b3f35] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] scrollbar-width:none hover:[&::-webkit-scrollbar]:w-2 hover:[&::-webkit-scrollbar]:block"
                  >
                    {outputContent}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {typeof document !== "undefined" && modalOpen && modalContent && (
        <ContentModal
          title={modalContent.title}
          toolCallId={invocation.toolCallId}
          content={modalContent.content}
          onClose={closeModal}
        />
      )}
    </>
  );
}
