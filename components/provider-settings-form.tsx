"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { builtInTools } from "@/lib/built-in-tools";
import {
  defaultProviderConfig,
  DEBOUNCE_DELAY_MS,
  loadProviderConfigFromStorage,
  normalizeProviderConfig,
  saveProviderConfigToStorage,
  type ProviderConfig,
} from "@/lib/provider-config";

type FetchModelsState =
  | { status: "idle"; error: string | null }
  | { status: "loading"; error: string | null }
  | { status: "success"; error: string | null }
  | { status: "error"; error: string };

type SettingsSection = "model" | "tools";

export function ProviderSettingsForm() {
  const [form, setForm] = useState<ProviderConfig>(defaultProviderConfig);
  const [models, setModels] = useState<string[]>([]);
  const [toolUsageCounts, setToolUsageCounts] = useState<Record<string, number>>({});
  const [fetchState, setFetchState] = useState<FetchModelsState>({
    status: "idle",
    error: null,
  });
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("model");
  const [manualFetchTrigger, setManualFetchTrigger] = useState(0);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    const config = loadProviderConfigFromStorage();
    setForm(config);
    initialLoadDone.current = true;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadToolUsageCounts() {
      try {
        const response = await fetch("/api/tool-stats");
        const payload = (await response.json()) as {
          counts?: Record<string, number>;
        };

        if (!response.ok || cancelled) {
          return;
        }

        setToolUsageCounts(payload.counts ?? {});
      } catch {
        if (!cancelled) {
          setToolUsageCounts({});
        }
      }
    }

    void loadToolUsageCounts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!initialLoadDone.current) {
      return;
    }

    if (!form.baseUrl.trim() || !form.apiKey.trim()) {
      setModels([]);
      setFetchState({ status: "idle", error: null });
      return;
    }

    const controller = new AbortController();
    const nextProviderConfig = {
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
    };
    const timeout = window.setTimeout(async () => {
      try {
        setFetchState({ status: "loading", error: null });

        const response = await fetch("/api/models", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            providerConfig: nextProviderConfig,
          }),
          signal: controller.signal,
        });

        const payload = (await response.json()) as {
          models?: string[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "拉取模型失败。");
        }

        const nextModels = payload.models ?? [];
        setModels(nextModels);
        setFetchState({ status: "success", error: null });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setModels([]);
        setFetchState({
          status: "error",
          error:
            error instanceof Error ? error.message : "拉取模型时发生未知错误。",
        });
      }
    }, DEBOUNCE_DELAY_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [form.baseUrl, form.apiKey, manualFetchTrigger]);

  function updateField<Key extends keyof ProviderConfig>(
    key: Key,
    value: ProviderConfig[Key],
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextConfig = normalizeProviderConfig(form);
    saveProviderConfigToStorage(nextConfig);
    setForm(nextConfig);
  }

  return (
    <main className="app-shell h-screen overflow-hidden text-[#171717]">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="dark-panel rise-in relative h-full overflow-hidden border-r border-white/10 p-4">
          <div className="relative flex h-full flex-col">
            <div className="border-b border-white/8 pb-4">
              <p className="text-[11px] uppercase tracking-[0.28em] text-[#c4b6a4]">
                Agent Chat Lab
              </p>
              <h1 className="mt-3 text-[28px] font-semibold leading-[0.95] text-[#fff7ef]">
                系统设置
              </h1>
              <Link
                href="/"
                className="mt-3 inline-flex rounded-md border border-white/12 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#f3dfcf] transition hover:border-[#d98a52] hover:bg-white/6"
              >
                返回聊天
              </Link>
            </div>

            <div className="pt-4">
              <div className="space-y-1 border-b border-white/8 pb-4">
                <button
                  type="button"
                  onClick={() => setActiveSection("model")}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-3 text-left transition ${
                    activeSection === "model"
                      ? "border-white/16 bg-white/10 text-[#fff7ef]"
                      : "border-transparent text-[#cabfb2] hover:border-white/10 hover:bg-white/6 hover:text-[#fff7ef]"
                  }`}
                >
                  <span
                    className={`text-sm font-medium ${
                      activeSection === "model" ? "text-[#fff7ef]" : "text-[#e2d7ca]"
                    }`}
                  >
                    模型配置
                  </span>
                  <span className="text-xs">↗</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection("tools")}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-3 text-left transition ${
                    activeSection === "tools"
                      ? "border-white/16 bg-white/10 text-[#fff7ef]"
                      : "border-transparent text-[#cabfb2] hover:border-white/10 hover:bg-white/6 hover:text-[#fff7ef]"
                  }`}
                >
                  <span
                    className={`text-sm font-medium ${
                      activeSection === "tools" ? "text-[#fff7ef]" : "text-[#e2d7ca]"
                    }`}
                  >
                    内置 Tools
                  </span>
                  <span className="text-xs">↗</span>
                </button>
              </div>
            </div>
          </div>
        </aside>

        <section className="glass-panel rise-in flex h-full min-h-0 flex-col overflow-hidden">
          <div className="border-b border-[rgba(23,23,23,0.08)] px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#8a8176]">
              System Settings
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <form onSubmit={handleSave} className="max-w-3xl space-y-6">
            {activeSection === "model" ? (
              <>
                <section className="border-t border-[rgba(23,23,23,0.08)] pt-6 first:border-t-0 first:pt-0">
                  <div className="mb-5">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                      模型配置
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#6e665d]">
                      配置 Base URL、API Key 和模型名称。支持从模型列表选择或手动输入，配置将保存在本地存储中。
                    </p>
                  </div>

                  <div className="grid gap-6">
                    <label className="block">
                      <span className="mb-2 block text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                        Base URL
                      </span>
                      <input
                        value={form.baseUrl}
                        onChange={(event) =>
                          updateField("baseUrl", event.target.value)
                        }
                        placeholder="https://api.openai.com/v1"
                        className="w-full rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-4 py-3 text-sm text-[#171717] outline-none transition placeholder:text-[#a39a90] focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                        API Key
                      </span>
                      <input
                        type="password"
                        value={form.apiKey}
                        onChange={(event) =>
                          updateField("apiKey", event.target.value)
                        }
                        placeholder="sk-..."
                        className="w-full rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-4 py-3 text-sm text-[#171717] outline-none transition placeholder:text-[#a39a90] focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                      />
                    </label>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="block text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                          Model
                        </span>
                        {fetchState.status === "success" && models.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setManualFetchTrigger((prev) => prev + 1)}
                            className="text-[11px] text-[#9c5626] transition hover:text-[#a44d16]"
                          >
                            刷新列表
                          </button>
                        ) : null}
                      </div>

                      {fetchState.status === "success" && models.length > 0 ? (
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <select
                            value={isCustomModel ? "" : form.model}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (value === "__custom__") {
                                setIsCustomModel(true);
                                updateField("model", "");
                              } else {
                                setIsCustomModel(false);
                                updateField("model", value);
                              }
                            }}
                            className="w-full rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-4 py-3 text-sm text-[#171717] outline-none transition focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                          >
                            <option value="">
                              {form.model && !models.includes(form.model)
                                ? `当前：${form.model} (不在列表中)`
                                : "选择模型"}
                            </option>
                            {models.map((model) => (
                              <option key={model} value={model}>
                                {model}
                              </option>
                            ))}
                            <option value="__custom__">自定义...</option>
                          </select>

                          {isCustomModel ? (
                            <input
                              type="text"
                              value={form.model}
                              onChange={(event) =>
                                updateField("model", event.target.value)
                              }
                              placeholder="模型名称"
                              className="w-full rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-4 py-3 text-sm text-[#171717] outline-none transition placeholder:text-[#a39a90] focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                              autoFocus
                            />
                          ) : (
                            <div className="rounded-lg border border-[rgba(23,23,23,0.08)] bg-[rgba(248,242,235,0.8)] px-4 py-3 text-sm text-[#6e665d]">
                              {form.model
                                ? `已选择：${form.model}`
                                : "从下拉列表选择或手动输入"}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <input
                            value={form.model}
                            onChange={(event) =>
                              updateField("model", event.target.value)
                            }
                            placeholder="例如：gpt-4o"
                            className="w-full rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-4 py-3 text-sm text-[#171717] outline-none transition placeholder:text-[#a39a90] focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                          />
                          {fetchState.status === "error" ? (
                            <p className="mt-2 text-xs text-[#8a8176]">
                              无法拉取模型列表，请手动输入模型名称。
                              <button
                                type="button"
                                onClick={() => setManualFetchTrigger((prev) => prev + 1)}
                                className="ml-2 text-[#9c5626] transition hover:text-[#a44d16]"
                              >
                                重试
                              </button>
                            </p>
                          ) : (
                            <p className="mt-2 text-xs text-[#8a8176]">
                              配置将自动保存。
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <div className="flex items-center justify-end border-t border-[rgba(23,23,23,0.08)] pt-5">

                  <button
                    type="submit"
                    className="rounded-full bg-[#171717] px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-white transition hover:bg-[#2b241d]"
                  >
                    保存
                  </button>
                </div>
              </>
            ) : (
              <section className="border-t border-[rgba(23,23,23,0.08)] pt-6 first:border-t-0 first:pt-0">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                      内置 Tools
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[#6e665d]">
                      这里展示当前应用内置的工具能力。部分工具支持单独配置，例如 WebSearch 依赖 Tavily API Key。
                    </p>
                  </div>
                  <span className="rounded-full border border-[rgba(23,23,23,0.1)] px-3 py-1 text-[11px] text-[#6e665d]">
                    {builtInTools.length} 个
                  </span>
                </div>

                <div className="mb-5 rounded-lg border border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.72)] p-4">
                  <label className="block">
                    <span className="mb-2 block text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                      Tavily API Key
                    </span>
                    <input
                      type="password"
                      value={form.tavilyApiKey}
                      onChange={(event) =>
                        updateField("tavilyApiKey", event.target.value)
                      }
                      placeholder="tvly-..."
                      className="w-full rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-4 py-3 text-sm text-[#171717] outline-none transition placeholder:text-[#a39a90] focus:border-[rgba(201,106,43,0.45)] focus:bg-white"
                    />
                  </label>
                  <p className="mt-2 text-xs leading-5 text-[#8a8176]">
                    `WebSearch` 会在需要联网查询最新网页信息时自动调用。此 Key 保存在当前浏览器本地存储；未填写时，服务端会回退到环境变量 `TAVILY_API_KEY`。
                  </p>
                </div>

                <div className="space-y-3">
                  {builtInTools.map((tool) => (
                    <div
                      key={tool.name}
                      className="rounded-lg border border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.64)] px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-mono text-[12px] text-[#9c5626]">
                          {tool.name}
                        </p>
                        <span className="shrink-0 rounded-full border border-[rgba(23,23,23,0.1)] px-2.5 py-1 text-[11px] text-[#6e665d]">
                          调用 {toolUsageCounts[tool.name] ?? 0} 次
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[#4d4339]">
                        {tool.description}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-end border-t border-[rgba(23,23,23,0.08)] pt-5">
                  <button
                    type="submit"
                    className="rounded-full bg-[#171717] px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-white transition hover:bg-[#2b241d]"
                  >
                    保存
                  </button>
                </div>
              </section>
            )}
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
