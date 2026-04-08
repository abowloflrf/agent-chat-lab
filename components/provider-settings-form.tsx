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
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchModelsState>({
    status: "idle",
    error: null,
  });
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>("model");
  const initialLoadDone = useRef(false);

  useEffect(() => {
    const config = loadProviderConfigFromStorage();
    setForm(config);
    initialLoadDone.current = true;
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
      model: form.model,
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

        if (nextModels.length > 0) {
          setForm((current) => {
            if (!nextModels.includes(current.model)) {
              return {
                ...current,
                model: nextModels[0],
              };
            }
            return current;
          });
        }
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
  }, [form.baseUrl, form.apiKey, form.model]);

  function updateField<Key extends keyof ProviderConfig>(
    key: Key,
    value: ProviderConfig[Key],
  ) {
    setSaveMessage(null);
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
    setSaveMessage("已保存。");
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
                      配置 Base URL、API Key 和默认模型。Base URL 与 API Key 可用时会自动尝试拉取模型列表。
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
                      <span className="mb-2 block text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                        Model
                      </span>
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
                            {models.length > 0
                              ? "选择模型或手动输入"
                              : "等待拉取模型列表"}
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
                            {fetchState.status === "loading"
                              ? "正在拉取模型列表..."
                              : fetchState.status === "success"
                                ? "已拿到模型列表，可直接选择。"
                                : "如未能拉取，可改为手动输入模型名。"}
                          </div>
                        )}
                      </div>

                      {fetchState.status === "error" ? (
                        <p className="mt-2 text-sm text-[#b2411d]">
                          {fetchState.error}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </section>

                <div className="flex items-center justify-between border-t border-[rgba(23,23,23,0.08)] pt-5">
                  <div className="text-sm text-[#6e665d]">
                    {saveMessage ? (
                      <span className="text-[#2f6a35]">{saveMessage}</span>
                    ) : (
                      <span>配置保存在浏览器本地存储中。</span>
                    )}
                  </div>

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
                      这里只展示当前应用内置的工具能力，不提供额外配置项。
                    </p>
                  </div>
                  <span className="rounded-full border border-[rgba(23,23,23,0.1)] px-3 py-1 text-[11px] text-[#6e665d]">
                    {builtInTools.length} 个
                  </span>
                </div>

                <div className="space-y-3">
                  {builtInTools.map((tool) => (
                    <div
                      key={tool.name}
                      className="rounded-lg border border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.64)] px-4 py-4"
                    >
                      <p className="font-mono text-[12px] text-[#9c5626]">
                        {tool.name}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[#4d4339]">
                        {tool.description}
                      </p>
                    </div>
                  ))}
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
