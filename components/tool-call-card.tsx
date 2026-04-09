"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  assessBashCommand,
  BASH_TOOL_OUTPUT_LIMIT,
  BASH_TOOL_TIMEOUT_MS,
} from "@/lib/ai/bash-policy";

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

function extractBashCommand(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as {
    command?: unknown;
  };

  return typeof record.command === "string" ? record.command : null;
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
  const approvalId = invocation.approval?.id;
  const isApprovalRequested = invocation.state === "approval-requested";
  const isApprovalResponded = invocation.state === "approval-responded";

  return (
    <>
      <section className="rounded-[18px] border border-[rgba(23,23,23,0.08)] bg-[rgba(255,248,241,0.82)] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#a44d16]">
              {toolName}
            </p>
            <p className="mt-1 text-xs text-[#2f261d] font-mono">
              #{invocation.toolCallId}
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

        {toolName === "Bash" && bashAssessment ? (
          <div className="mt-4 rounded-[16px] border border-[rgba(23,23,23,0.08)] bg-white/80 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-[#8e8070]">
                即将执行
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${
                  bashAssessment.decision === "deny"
                    ? "bg-[#fee2e2] text-[#991b1b]"
                    : bashAssessment.riskLevel === "low"
                      ? "bg-[#e7f4e5] text-[#36643a]"
                      : "bg-[#fff1d6] text-[#9a5b05]"
                }`}
              >
                {bashAssessment.decision === "deny"
                  ? "高风险已拦截"
                  : `风险 ${bashAssessment.riskLevel}`}
              </span>
            </div>

            <pre className="mt-3 overflow-x-auto rounded-[14px] bg-[#1f1711] px-4 py-3 font-mono text-[12px] leading-6 text-[#fff4eb]">
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

        {toolName !== "Bash" && isApprovalRequested && approvalId ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[rgba(23,23,23,0.08)] pt-4">
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

        <div className="mt-4 grid gap-3 border-t border-[rgba(23,23,23,0.08)] pt-4 md:grid-cols-2">
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
              className="mt-2 max-h-48 cursor-pointer overflow-y-auto rounded-[14px] bg-white px-4 py-3 font-mono text-[11px] leading-6 text-[#4b3f35] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] scrollbar-width:none hover:[&::-webkit-scrollbar]:w-2 hover:[&::-webkit-scrollbar]:block"
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
              className="mt-2 max-h-48 cursor-pointer overflow-y-auto rounded-[14px] bg-white px-4 py-3 font-mono text-[11px] leading-6 text-[#4b3f35] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] scrollbar-width:none hover:[&::-webkit-scrollbar]:w-2 hover:[&::-webkit-scrollbar]:block"
            >
              {outputContent}
            </pre>
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
