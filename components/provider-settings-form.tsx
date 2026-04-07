"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

export function ProviderSettingsForm() {
  const [form, setForm] = useState<ProviderConfig>(defaultProviderConfig);
  const [models, setModels] = useState<string[]>([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchModelsState>({
    status: "idle",
    error: null,
  });
  const [isCustomModel, setIsCustomModel] = useState(false);
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(15,23,42,0.12),_transparent_26%),linear-gradient(180deg,_#f3ede4_0%,_#ece2d4_55%,_#e7d8c2_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="flex flex-col gap-4 rounded-[2rem] border border-black/10 bg-white/70 p-6 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                System Settings
              </p>
              <h1 className="text-3xl font-semibold">模型供应商配置</h1>
            </div>

            <Link
              href="/"
              className="inline-flex rounded-full border border-black/10 px-4 py-2 text-sm text-slate-700 transition hover:bg-black/5"
            >
              返回聊天页
            </Link>
          </div>
        </header>

        <section>
          <form
            onSubmit={handleSave}
            className="rounded-[2rem] border border-black/10 bg-white/80 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur"
          >
            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
                  Base URL
                </label>
                <input
                  value={form.baseUrl}
                  onChange={(event) =>
                    updateField("baseUrl", event.target.value)
                  }
                  placeholder="https://api.openai.com/v1"
                  className="w-full rounded-2xl border border-black/10 bg-stone-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-300 focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
                  API Key
                </label>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(event) =>
                    updateField("apiKey", event.target.value)
                  }
                  placeholder="sk-..."
                  className="w-full rounded-2xl border border-black/10 bg-stone-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-300 focus:bg-white"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
                  Model
                </label>
                <div className="flex gap-3">
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
                    className="w-full rounded-2xl border border-black/10 bg-stone-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-300 focus:bg-white"
                  >
                    <option value="">
                      {models.length > 0
                        ? "请选择模型或手动输入"
                        : "等待自动拉取 models 列表"}
                    </option>
                    {models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                    <option value="__custom__">自定义模型...</option>
                  </select>
                  {isCustomModel && (
                    <input
                      type="text"
                      value={form.model}
                      onChange={(event) =>
                        updateField("model", event.target.value)
                      }
                      placeholder="输入自定义模型名称"
                      className="w-full rounded-2xl border border-black/10 bg-stone-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-300 focus:bg-white"
                      autoFocus
                    />
                  )}
                </div>
                {fetchState.status === "loading" ? (
                  <p className="mt-2 text-xs leading-6 text-slate-500">
                    正在拉取模型列表...
                  </p>
                ) : null}
                {fetchState.status === "error" ? (
                  <p className="mt-2 text-xs leading-6 text-red-600">
                    {fetchState.error}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex justify-end border-t border-black/10 pt-5">
              <button
                type="submit"
                className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                保存配置
              </button>
            </div>

            {saveMessage ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
                {saveMessage}
              </div>
            ) : null}
          </form>
        </section>
      </div>
    </main>
  );
}
