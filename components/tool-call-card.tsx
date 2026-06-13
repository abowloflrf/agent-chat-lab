"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  parseAskUserQuestionOutput,
  type AskUserQuestionOutput,
} from "@/lib/ai/ask-user-question";
import {
  assessBashCommand,
  BASH_TOOL_OUTPUT_LIMIT,
  BASH_TOOL_TIMEOUT_MS,
} from "@/lib/ai/bash-policy";
import { AskUserQuestionPanel } from "@/components/ask-user-question-card";
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

type ApprovalResponseHandler = (
  approvalId: string,
  approved: boolean,
) => Promise<void> | void;

type QuestionAnswerHandler = (
  toolCallId: string,
  output: AskUserQuestionOutput,
) => Promise<void> | void;

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

type ToolStatus = "running" | "success" | "error" | "waiting";

function getToolStatus(invocation: ToolInvocation): ToolStatus {
  if (invocation.state === "approval-requested") {
    return "waiting";
  }

  if (
    toToolName(invocation) === ASK_USER_QUESTION_TOOL_NAME &&
    invocation.state === "input-available"
  ) {
    return "waiting";
  }

  switch (invocation.state) {
    case "output-available":
      return "success";
    case "output-error":
    case "output-denied":
      return "error";
    default:
      // input-streaming / input-available / approval-responded
      return "running";
  }
}

/**
 * 该调用当前是否真的可被用户操作。审批与提问都只在所属消息是最后一条
 * 且不在流式中时可操作（interactionEnabled），否则点击审批按钮会被
 * SDK 静默忽略（addToolApprovalResponse 只匹配最后一条消息的 part）。
 */
function isActionable(invocation: ToolInvocation, interactionEnabled?: boolean) {
  if (!interactionEnabled) {
    return false;
  }

  if (invocation.state === "approval-requested" && invocation.approval?.id) {
    return true;
  }

  return (
    toToolName(invocation) === ASK_USER_QUESTION_TOOL_NAME &&
    invocation.state === "input-available"
  );
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

  if (
    toolName === ASK_USER_QUESTION_TOOL_NAME &&
    typeof record.question === "string"
  ) {
    const question = record.question.trim();
    return question.length > 80 ? question.slice(0, 77) + "..." : question;
  }

  if (toolName === "WebSearch" && typeof record.query === "string") {
    return record.query;
  }

  if (
    (toolName === "read" || toolName === "write" || toolName === "edit") &&
    typeof record.path === "string"
  ) {
    return record.path;
  }

  if (toolName === "WebFetch") {
    if (Array.isArray(record.urls)) {
      const urls = record.urls.filter(
        (value): value is string => typeof value === "string",
      );

      if (urls.length > 0) {
        return urls.length === 1 ? urls[0] : `${urls[0]} 等 ${urls.length} 个 URL`;
      }
    }

    // 兼容历史会话里用单数 url 抓取的旧 WebFetch 调用
    if (typeof record.url === "string") {
      return record.url;
    }
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

/** 行摘要：已回答的提问追加答案，让折叠态也能回顾决策。 */
function buildRowSummary(invocation: ToolInvocation, toolName: string) {
  const inputSummary = extractInputSummary(toolName, invocation.input);

  if (
    toolName !== ASK_USER_QUESTION_TOOL_NAME ||
    invocation.state !== "output-available"
  ) {
    return inputSummary;
  }

  const parsedOutput = parseAskUserQuestionOutput(invocation.output);

  if (!parsedOutput) {
    return inputSummary;
  }

  if (parsedOutput.answer) {
    return inputSummary
      ? `${inputSummary} → ${parsedOutput.answer}`
      : parsedOutput.answer;
  }

  const outcomeLabel = parsedOutput.outcome === "skipped" ? "已跳过" : "未作答";
  return inputSummary ? `${inputSummary}（${outcomeLabel}）` : outcomeLabel;
}

function SpinnerIcon() {
  return (
    <svg
      aria-hidden="true"
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
  );
}

function SuccessIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 flex-shrink-0 text-[#36643a]"
      viewBox="0 0 16 16"
      fill="none"
    >
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

function ErrorIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 flex-shrink-0 text-[#991b1b]"
      viewBox="0 0 16 16"
      fill="none"
    >
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

/** 等待用户操作：问号（提问）或感叹号（审批），静态琥珀色，与“运行中”区分。 */
function WaitingIcon({ kind }: { kind: "question" | "approval" }) {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5 flex-shrink-0 text-[#9a5b05]"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle cx="8" cy="8" r="7" fill="#fff1d6" stroke="#9a5b05" strokeWidth="1" />
      {kind === "question" ? (
        <>
          <path
            d="M6.1 6.1a1.9 1.9 0 1 1 2.75 1.7c-.55.28-.85.62-.85 1.2v.25"
            stroke="#9a5b05"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11.6" r="0.9" fill="#9a5b05" />
        </>
      ) : (
        <>
          <path
            d="M8 4.4v4.4"
            stroke="#9a5b05"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11.4" r="0.9" fill="#9a5b05" />
        </>
      )}
    </svg>
  );
}

function StatusIcon({
  status,
  waitingKind,
}: {
  status: ToolStatus;
  waitingKind: "question" | "approval";
}) {
  if (status === "running") {
    return <SpinnerIcon />;
  }

  if (status === "success") {
    return <SuccessIcon />;
  }

  if (status === "waiting") {
    return <WaitingIcon kind={waitingKind} />;
  }

  return <ErrorIcon />;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
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
  );
}

function rowBadge(
  invocation: ToolInvocation,
  status: ToolStatus,
  isQuestionTool: boolean,
  actionable: boolean,
) {
  if (status === "waiting") {
    if (!actionable) {
      return {
        text: "已失效",
        className: "rounded-full bg-[rgba(23,23,23,0.06)] px-2 py-0.5 text-[#6d6257]",
      };
    }

    return {
      text: isQuestionTool ? "等待回答" : "等待审批",
      className: "rounded-full bg-[#fff1d6] px-2 py-0.5 text-[#9a5b05]",
    };
  }

  if (status === "error") {
    return {
      text: invocation.state === "output-denied" ? "已拒绝" : "失败",
      className: "rounded-full bg-[#fee2e2] px-2 py-0.5 text-[#991b1b]",
    };
  }

  if (status === "running") {
    // 审批已提交的瞬态：明确告诉用户点击已生效，而不是笼统的“运行中”。
    if (invocation.state === "approval-responded") {
      return {
        text: invocation.approval?.approved ? "已批准，执行中" : "已拒绝，处理中",
        className: "tool-running-indicator text-[#9a5b05]",
      };
    }

    return {
      text: invocation.state === "input-streaming" ? "生成参数" : "运行中",
      className: "tool-running-indicator text-[#9a5b05]",
    };
  }

  return null;
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // 焦点管理只在挂载/卸载时执行一次，避免父组件流式重渲导致焦点被反复拉走。
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="关闭"
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

function IOPanel({
  label,
  content,
  onExpand,
}: {
  label: string;
  content: string;
  onExpand: () => void;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[#6d6257]">
          {label}
        </p>
        <button
          type="button"
          onClick={onExpand}
          className="-my-1.5 rounded px-2 py-1.5 text-[10px] text-[#a44d16] transition-colors hover:bg-[rgba(201,106,43,0.08)] hover:text-[#8b3d0f]"
        >
          展开
        </button>
      </div>
      <pre className="mt-1.5 max-h-48 overflow-y-auto rounded-[10px] bg-white px-3 py-2.5 font-mono text-[11px] leading-6 text-[#4b3f35]">
        {content}
      </pre>
    </div>
  );
}

function ToolCallRow({
  invocation,
  actionable,
  onApprovalResponse,
  onQuestionAnswer,
}: {
  invocation: ToolInvocation;
  actionable: boolean;
  onApprovalResponse?: ApprovalResponseHandler;
  onQuestionAnswer?: QuestionAnswerHandler;
}) {
  const toolName = toToolName(invocation);
  const status = getToolStatus(invocation);
  const failed = invocation.state === "output-error";
  const isApprovalRequested = invocation.state === "approval-requested";
  const isApprovalResponded = invocation.state === "approval-responded";
  const approvalId = invocation.approval?.id;
  const isQuestionTool = toolName === ASK_USER_QUESTION_TOOL_NAME;
  const isPendingQuestion = isQuestionTool && invocation.state === "input-available";

  const [userExpanded, setUserExpanded] = useState(false);
  const [approvalPending, setApprovalPending] = useState(false);
  const [modalContent, setModalContent] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const headerRef = useRef<HTMLButtonElement>(null);

  // 等待用户操作时强制展开；此时不渲染可点击 header（见下），
  // 操作完成后行会回落到折叠态。
  const expanded = actionable || userExpanded;

  const respondApproval = async (approved: boolean) => {
    if (approvalPending || !approvalId) {
      return;
    }

    setApprovalPending(true);
    try {
      await onApprovalResponse?.(approvalId, approved);
    } finally {
      setApprovalPending(false);
      // 审批面板随状态切换卸载，把焦点送回行头，避免键盘焦点掉到 body。
      requestAnimationFrame(() => headerRef.current?.focus());
    }
  };

  const openModal = (title: string, content: string) => {
    setModalContent({ title, content });
  };

  const inputContent = formatJson(invocation.input);
  const outputContent = failed
    ? invocation.errorText ?? ""
    : formatJson(invocation.output);
  const bashCommand = toolName === "Bash" ? extractBashCommand(invocation.input) : null;
  const bashAssessment = bashCommand ? assessBashCommand(bashCommand) : null;
  const summary = buildRowSummary(invocation, toolName);
  const badge = rowBadge(invocation, status, isQuestionTool, actionable);
  const showTodoPanel =
    isTodoToolName(toolName) && invocation.state === "output-available";
  // 有专属面板的工具把原始 JSON 收进“原始数据”，避免同一信息渲染两遍。
  const hasSpecializedView = isQuestionTool || showTodoPanel || toolName === "Bash";

  const headerContent = (
    <>
      <StatusIcon
        status={status}
        waitingKind={isQuestionTool ? "question" : "approval"}
      />
      {status === "success" ? <span className="sr-only">成功</span> : null}

      <span className="flex-shrink-0 font-mono text-[11px] font-medium text-[#a44d16]">
        {toolName}
      </span>

      {summary ? (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#6d6257]">
          {summary}
        </span>
      ) : (
        <span className="flex-1" />
      )}

      {badge ? (
        <span className={`flex-shrink-0 text-[10px] font-medium ${badge.className}`}>
          {badge.text}
        </span>
      ) : null}

      {actionable ? null : <ChevronIcon expanded={expanded} />}
    </>
  );

  return (
    <div>
      {/* Row header — 等待操作时是纯展示节点，不进 Tab 序列也不响应点击 */}
      {actionable ? (
        <div className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
          {headerContent}
        </div>
      ) : (
        <button
          ref={headerRef}
          type="button"
          onClick={() => setUserExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[rgba(201,106,43,0.05)]"
        >
          {headerContent}
        </button>
      )}

      {/* Expandable detail */}
      <div
        className={`grid transition-[grid-template-rows] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 border-t border-[rgba(23,23,23,0.06)] px-3 pb-3 pt-3">
            {/* AskUserQuestion interactive panel / answered summary */}
            {isQuestionTool ? (
              <AskUserQuestionPanel
                input={invocation.input}
                output={invocation.output}
                state={invocation.state}
                toolCallId={invocation.toolCallId}
                interactive={isPendingQuestion && actionable}
                onAnswer={onQuestionAnswer}
              />
            ) : null}

            {/* Bash: command is always visible when expanded */}
            {bashAssessment ? (
              <pre className="overflow-x-auto rounded-[10px] bg-[#1f1711] px-4 py-3 font-mono text-[12px] leading-6 text-[#fff4eb]">
                {bashAssessment.normalizedCommand}
              </pre>
            ) : null}

            {/* Bash: full risk assessment only while approval is pending */}
            {bashAssessment && (isApprovalRequested || isApprovalResponded) ? (
              <div className="rounded-[12px] border border-[rgba(23,23,23,0.08)] bg-white/80 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.18em] text-[#6d6257]">
                    即将执行
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
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

                <div className="mt-3 grid gap-3 text-[12px] text-[#4b3f35] md:grid-cols-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#6d6257]">
                      Workdir
                    </p>
                    <p className="mt-1 break-all font-mono">{bashAssessment.workdir}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#6d6257]">
                      Timeout
                    </p>
                    <p className="mt-1 font-mono">{BASH_TOOL_TIMEOUT_MS}ms</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#6d6257]">
                      Output Limit
                    </p>
                    <p className="mt-1 font-mono">{BASH_TOOL_OUTPUT_LIMIT} bytes</p>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#6d6257]">
                    风险说明
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] leading-6 text-[#4b3f35]">
                    {bashAssessment.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>

                {isApprovalRequested && approvalId && actionable ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void respondApproval(true)}
                      disabled={approvalPending || bashAssessment.decision === "deny"}
                      className="rounded-full bg-[#171717] px-4 py-2 text-[11px] font-medium text-white transition hover:bg-[#2b241d] disabled:cursor-not-allowed disabled:bg-[#b8afa6]"
                    >
                      {approvalPending ? "提交中…" : "允许执行"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void respondApproval(false)}
                      disabled={approvalPending}
                      className="rounded-full border border-[rgba(23,23,23,0.14)] px-4 py-2 text-[11px] font-medium text-[#4a4138] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      拒绝执行
                    </button>
                  </div>
                ) : null}

                {isApprovalRequested && !actionable ? (
                  <p className="mt-4 text-[12px] text-[#6b5b4f]">
                    此审批已失效，发送新消息时会自动按拒绝处理。
                  </p>
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

            {/* Non-Bash approval */}
            {toolName !== "Bash" && isApprovalRequested ? (
              approvalId && actionable ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void respondApproval(true)}
                    disabled={approvalPending}
                    className="rounded-full bg-[#171717] px-4 py-2 text-[11px] font-medium text-white transition hover:bg-[#2b241d] disabled:cursor-not-allowed disabled:bg-[#b8afa6]"
                  >
                    {approvalPending ? "提交中…" : "允许执行"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void respondApproval(false)}
                    disabled={approvalPending}
                    className="rounded-full border border-[rgba(23,23,23,0.14)] px-4 py-2 text-[11px] font-medium text-[#4a4138] transition hover:border-[rgba(201,106,43,0.35)] hover:text-[#9c5626] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    拒绝执行
                  </button>
                </div>
              ) : (
                <p className="text-[12px] text-[#6b5b4f]">
                  此审批已失效，发送新消息时会自动按拒绝处理。
                </p>
              )
            ) : null}

            {/* Todo-specific formatted result */}
            {showTodoPanel ? (
              <TodoToolPanel toolName={toolName} output={invocation.output} />
            ) : null}

            {/* Bash output stays visible; its input lives in 原始数据 below */}
            {toolName === "Bash" && !isApprovalRequested && !isApprovalResponded ? (
              <IOPanel
                label="Output"
                content={outputContent}
                onExpand={() => openModal(`${toolName} - Output`, outputContent)}
              />
            ) : null}

            {/* Raw input/output: inline for generic tools, tucked away for specialized ones */}
            {hasSpecializedView ? (
              <details className="rounded-[10px] border border-[rgba(23,23,23,0.06)] bg-white/60">
                <summary className="cursor-pointer select-none px-3 py-2 text-[11px] text-[#6d6257] transition-colors hover:text-[#9c5626]">
                  原始数据
                </summary>
                <div className="grid gap-3 border-t border-[rgba(23,23,23,0.06)] p-3 md:grid-cols-2">
                  <IOPanel
                    label="Input"
                    content={inputContent}
                    onExpand={() => openModal(`${toolName} - Input`, inputContent)}
                  />
                  <IOPanel
                    label="Output"
                    content={outputContent}
                    onExpand={() => openModal(`${toolName} - Output`, outputContent)}
                  />
                </div>
              </details>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <IOPanel
                  label="Input"
                  content={inputContent}
                  onExpand={() => openModal(`${toolName} - Input`, inputContent)}
                />
                <IOPanel
                  label="Output"
                  content={outputContent}
                  onExpand={() => openModal(`${toolName} - Output`, outputContent)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {modalContent ? (
        <ContentModal
          title={modalContent.title}
          toolCallId={invocation.toolCallId}
          content={modalContent.content}
          onClose={() => setModalContent(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * 一段连续的工具调用渲染为一个分组容器：
 * - 单个调用：一行，无分组头。
 * - 多个调用：带统计头，全部成功结束的历史分组默认折叠成一行；
 *   只要还有运行中/等待操作的调用就保持展开（且不可折叠）。
 * 单/多 part 共用同一子树结构（header 槽位 + rows 容器），避免 1→N
 * 增长时 React 重挂载行导致展开态丢失、Modal 被关闭。
 */
export function ToolCallGroup({
  parts,
  onApprovalResponse,
  onQuestionAnswer,
  interactionEnabled,
}: {
  parts: ToolInvocation[];
  onApprovalResponse?: ApprovalResponseHandler;
  onQuestionAnswer?: QuestionAnswerHandler;
  interactionEnabled?: boolean;
}) {
  const rows = parts.map((part) => {
    const status = getToolStatus(part);
    return {
      part,
      status,
      actionable: isActionable(part, interactionEnabled),
    };
  });

  const hasActionable = rows.some((row) => row.actionable);
  const hasRunning = rows.some((row) => row.status === "running");
  // 不可操作的 waiting（历史里失效的审批/提问）视同已结束，避免把分组永久锁死在展开态。
  const allSettled = rows.every(
    (row) =>
      row.status === "success" ||
      row.status === "error" ||
      (row.status === "waiting" && !row.actionable),
  );
  const allSuccess = rows.every((row) => row.status === "success");
  const errorCount = rows.filter((row) => row.status === "error").length;

  // 挂载时就已全部成功（加载历史会话）→ 默认折叠；
  // 流式过程中挂载 → 默认展开，结束后也不自动收起，避免界面跳动。
  const [userCollapsed, setUserCollapsed] = useState(
    () => parts.length > 1 && allSuccess,
  );
  const collapsible = parts.length > 1 && allSettled && !hasActionable;
  const collapsed = collapsible && userCollapsed;
  const showHeader = parts.length > 1;

  const containerClassName = `overflow-hidden rounded-[14px] border transition-colors duration-200 ${
    hasRunning || hasActionable
      ? "border-[rgba(201,106,43,0.25)] bg-[rgba(255,248,241,0.9)]"
      : "border-[rgba(23,23,23,0.08)] bg-[rgba(255,248,241,0.82)]"
  }`;

  const uniqueToolNames = [...new Set(parts.map(toToolName))];
  const groupBadge = hasActionable
    ? { text: "等待操作", className: "rounded-full bg-[#fff1d6] px-2 py-0.5 text-[#9a5b05]" }
    : hasRunning
      ? { text: "运行中", className: "tool-running-indicator text-[#9a5b05]" }
      : errorCount > 0
        ? { text: `${errorCount} 个失败`, className: "rounded-full bg-[#fee2e2] px-2 py-0.5 text-[#991b1b]" }
        : null;

  const headerContent = (
    <>
      {hasActionable ? (
        <WaitingIcon kind="approval" />
      ) : hasRunning ? (
        <SpinnerIcon />
      ) : errorCount > 0 ? (
        <ErrorIcon />
      ) : (
        <SuccessIcon />
      )}
      {allSuccess ? <span className="sr-only">全部成功</span> : null}

      <span className="flex-shrink-0 text-[11px] font-medium text-[#6d6257]">
        工具调用 ×{parts.length}
      </span>

      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#6d6257]">
        {uniqueToolNames.join(" · ")}
      </span>

      {groupBadge ? (
        <span
          className={`flex-shrink-0 text-[10px] font-medium ${groupBadge.className}`}
        >
          {groupBadge.text}
        </span>
      ) : null}

      {collapsible ? <ChevronIcon expanded={!collapsed} /> : null}
    </>
  );

  return (
    <section className={containerClassName}>
      {/* Group header（仅多调用时；不可折叠时不渲染成按钮） */}
      {showHeader ? (
        collapsible ? (
          <button
            type="button"
            onClick={() => setUserCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[rgba(201,106,43,0.05)]"
          >
            {headerContent}
          </button>
        ) : (
          <div className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
            {headerContent}
          </div>
        )
      ) : null}

      {/* Rows（单/多 part 结构一致，保证行组件不被重挂载） */}
      <div
        className={`grid transition-[grid-template-rows] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div
            className={
              showHeader
                ? "divide-y divide-[rgba(23,23,23,0.05)] border-t border-[rgba(23,23,23,0.06)]"
                : ""
            }
          >
            {rows.map((row) => (
              <ToolCallRow
                key={row.part.toolCallId}
                invocation={row.part}
                actionable={row.actionable}
                onApprovalResponse={onApprovalResponse}
                onQuestionAnswer={onQuestionAnswer}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
