"use client";

import { useEffect, useRef, useState } from "react";

/** 思考中的火花图标（脉动），与工具卡的状态圆点同处琥珀色系但形态区分。 */
function ThinkingIcon({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`h-3.5 w-3.5 flex-shrink-0 text-[#c96a2b] ${
        active ? "thinking-pulse" : ""
      }`}
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M8 1.4l1.18 3.34a3 3 0 0 0 1.9 1.9L14.6 8l-3.52 1.36a3 3 0 0 0-1.9 1.9L8 14.6l-1.18-3.34a3 3 0 0 0-1.9-1.9L1.4 8l3.52-1.36a3 3 0 0 0 1.9-1.9L8 1.4z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
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

/**
 * 推理（Thinking）卡片：与工具调用卡片共用容器/头部/展开动画的视觉语言。
 * - 思考中（streaming）：头部 "Thinking" 流光 + 火花脉动，下方贴底预览始终
 *   露出最新推理（旧行向上淡出）；点击头部可展开完整内容。
 * - 思考结束（done）：自动收起为单行头部 "Thought"，可手动展开回看完整推理。
 */
export function ReasoningCard({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [prevStreaming, setPrevStreaming] = useState(streaming);
  const fullRef = useRef<HTMLDivElement>(null);

  // 思考刚结束的瞬间自动收起（渲染期按来源调整 state，避免 effect 级联重渲）。
  if (prevStreaming !== streaming) {
    setPrevStreaming(streaming);
    if (!streaming) {
      setExpanded(false);
    }
  }

  // 展开态在流式时把完整视图滚到底，始终展示最新推理。预览区改用 flex 贴底
  // 对齐自动露出最新行，无需脚本滚动。
  useEffect(() => {
    if (!streaming || !expanded) {
      return;
    }
    if (fullRef.current) {
      fullRef.current.scrollTop = fullRef.current.scrollHeight;
    }
  }, [text, streaming, expanded]);

  const showPeek = streaming && !expanded;

  return (
    <section
      className={`overflow-hidden rounded-[14px] border transition-colors duration-200 ${
        streaming
          ? "border-[rgba(201,106,43,0.25)] bg-[rgba(255,248,241,0.9)]"
          : "border-[rgba(23,23,23,0.08)] bg-[rgba(255,248,241,0.82)]"
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={expanded ? "收起思考过程" : "展开思考过程"}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[rgba(201,106,43,0.05)]"
      >
        <ThinkingIcon active={streaming} />
        <span
          className={`flex-shrink-0 text-[11px] font-medium tracking-[0.04em] ${
            streaming ? "thinking-shimmer" : "text-[#a44d16]"
          }`}
        >
          {streaming ? "Thinking" : "Thought"}
        </span>
        <span className="flex-1" />
        <ChevronIcon expanded={expanded} />
      </button>

      {/* 思考中：贴底对齐露出最新推理，超出顶部由遮罩淡出，形成逐行上滚的预览 */}
      {showPeek ? (
        <div className="border-t border-[rgba(201,106,43,0.12)] px-3 py-2">
          <div className="reasoning-peek flex h-9 flex-col justify-end overflow-hidden">
            <p className="whitespace-pre-wrap text-[12px] italic leading-5 text-[#7a6450]">
              {text}
            </p>
          </div>
        </div>
      ) : null}

      {/* 展开：完整推理内容（与工具卡同款 grid 展开动画） */}
      <div
        className={`grid transition-[grid-template-rows] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div
            ref={fullRef}
            className="max-h-72 overflow-y-auto border-t border-[rgba(23,23,23,0.06)] px-3 py-3"
          >
            <p className="whitespace-pre-wrap text-[12.5px] leading-6 text-[#6b5340]">
              {text}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
