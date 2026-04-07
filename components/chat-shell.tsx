"use client";

import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ChatMessage } from "@/components/chat-message";
import {
  defaultProviderConfig,
  loadProviderConfigFromStorage,
  providerConfigChangedEvent,
  providerConfigStorageKey,
} from "@/lib/provider-config";

const starterPrompts = [
  "现在几点了？",
  "帮我计算 (18.5 + 7.2) * 3",
  "记住一条笔记：标题是 Agent 学习目标，内容是先学会工具调用和状态管理",
  "帮我回忆一下和 Agent 学习有关的笔记",
];

const builtInTools = [
  {
    name: "get_current_time",
    description: "读取当前时间，演示 Agent 如何访问运行时环境。",
  },
  {
    name: "calculator",
    description: "执行受限数学表达式计算，演示确定性工具。",
  },
  {
    name: "create_note",
    description: "写入一条内存笔记，演示 Agent 修改状态。",
  },
  {
    name: "search_notes",
    description: "检索已有笔记，演示最小记忆能力。",
  },
];

export function ChatShell() {
  const [draft, setDraft] = useState("");
  const providerConfig = useSyncExternalStore(
    (onStoreChange) => {
      const handleStorageChange = (event: StorageEvent) => {
        if (event.key === providerConfigStorageKey) {
          onStoreChange();
        }
      };

      window.addEventListener("storage", handleStorageChange);
      window.addEventListener(providerConfigChangedEvent, onStoreChange);

      return () => {
        window.removeEventListener("storage", handleStorageChange);
        window.removeEventListener(providerConfigChangedEvent, onStoreChange);
      };
    },
    () => JSON.stringify(loadProviderConfigFromStorage()),
    () => JSON.stringify(defaultProviderConfig),
  );
  const providerConfigObj = JSON.parse(providerConfig);
  const transport = new DefaultChatTransport({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ body, messages }) => ({
      body: {
        ...body,
        messages,
        providerConfig: loadProviderConfigFromStorage(),
      },
    }),
  });

  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
  });

  const isBusy = status !== "ready";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();

    if (!text || isBusy) {
      return;
    }

    setDraft("");
    await sendMessage({ text });
  }

  async function handleStarterPrompt(prompt: string) {
    if (isBusy) {
      return;
    }

    await sendMessage({ text: prompt });
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(240,94,35,0.24),_transparent_30%),linear-gradient(180deg,_#f4efe7_0%,_#efe6d8_48%,_#e8ddcd_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-4 lg:flex-row lg:px-6">
        <aside className="flex w-full flex-col justify-between rounded-xl border border-black/10 bg-black/[0.04] p-4 backdrop-blur lg:max-w-sm">
          <div className="space-y-8">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-600">
                  Agent Chat Lab
                </p>
                <Link
                  href="/settings"
                  className="rounded-md border border-black/10 px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-slate-700 transition hover:bg-black/5"
                >
                  系统设置
                </Link>
              </div>
              <h1 className="max-w-xs text-3xl font-semibold leading-tight">
                从 0 开始学习一个最小可解释 Agent
              </h1>
              <p className="max-w-sm text-sm leading-7 text-slate-700">
                这个项目故意保持简单: 一个聊天界面、一个模型、四个工具。
                重点不是炫技，而是让你看清 Agent 的基本流程。
              </p>
            </div>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">
                  当前模型配置
                </h2>
                <span className="rounded-md border border-black/10 px-2 py-1 text-xs text-slate-600">
                  {providerConfigObj.model ? "已配置" : "未配置"}
                </span>
              </div>
              <div className="rounded-lg border border-black/10 bg-white/70 p-3 text-sm leading-6 text-slate-700">
                <p>
                  <span className="font-medium text-slate-900">Base URL:</span>{" "}
                  <span className="font-mono text-xs">
                    {providerConfigObj.baseUrl || "未设置"}
                  </span>
                </p>
                <p className="mt-1">
                  <span className="font-medium text-slate-900">模型:</span>{" "}
                  <span className="font-mono text-xs">
                    {providerConfigObj.model || "未设置"}
                  </span>
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">
                  内置 Tools
                </h2>
                <span className="rounded-md border border-black/10 px-2 py-1 text-xs text-slate-600">
                  4 个
                </span>
              </div>
              <div className="space-y-3">
                {builtInTools.map((tool) => (
                  <div
                    key={tool.name}
                    className="rounded-lg border border-black/10 bg-white/70 p-3"
                  >
                    <div className="font-mono text-xs text-orange-700">
                      {tool.name}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-700">
                      {tool.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-600">
                学习顺序
              </h2>
              <ol className="space-y-2 text-sm leading-6 text-slate-700">
                <li>1. 用户输入进入 `/api/chat`</li>
                <li>2. 服务端拼接 system prompt 与历史消息</li>
                <li>3. 模型判断是否需要调用工具</li>
                <li>4. 本地工具执行并返回结构化结果</li>
                <li>5. 模型基于工具结果继续回答</li>
              </ol>
            </section>
          </div>

        </aside>

        <section className="flex min-h-[75vh] flex-1 flex-col overflow-hidden rounded-xl border border-black/10 bg-white/75 shadow-[0_20px_80px_rgba(15,23,42,0.10)] backdrop-blur">
          <header className="border-b border-black/10 px-5 py-4">
            <div>
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                  对话区
                </p>
                <h2 className="text-2xl font-semibold">最小 Agent 回路</h2>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col justify-between gap-8">
                <div className="max-w-2xl space-y-4">
                  <div className="inline-flex rounded-md border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-orange-700">
                    Stage 1
                  </div>
                  <h3 className="text-4xl font-semibold leading-tight text-slate-900">
                    先把一个能调用工具的聊天应用跑起来。
                  </h3>
                  <p className="max-w-xl text-base leading-8 text-slate-600">
                    你现在看到的是一个教学型起点。发一条普通消息、数学问题、
                    时间查询，或者让它记住一条笔记，然后观察工具调用卡片是怎样出现在消息流中的。
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void handleStarterPrompt(prompt)}
                      disabled={isBusy}
                      className="rounded-lg border border-black/10 bg-stone-50 p-4 text-left text-sm leading-7 text-slate-700 transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {messages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-black/10 px-5 py-4">
            {error ? (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                {error.message}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-3">
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
                  输入消息
                </span>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="例如：帮我记住一条笔记，标题是下周计划，内容是先补 tool calling 和 persistence。"
                  className="min-h-28 w-full resize-none rounded-xl border border-black/10 bg-stone-50 px-4 py-4 text-sm leading-7 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-300 focus:bg-white"
                  disabled={isBusy}
                />
              </label>

              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-xs leading-6 text-slate-500">
                  第一阶段先只保留服务端工具，不接数据库。这样你能更专注地看清 Agent loop。
                </p>

                <div className="flex items-center gap-3">
                  {isBusy ? (
                    <button
                      type="button"
                      onClick={() => void stop()}
                      className="rounded-md border border-black/10 px-4 py-2 text-sm text-slate-700 transition hover:bg-black/5"
                    >
                      停止生成
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={isBusy || draft.trim().length === 0}
                    className="rounded-md bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isBusy ? "生成中..." : "发送消息"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
