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
    setSaveMessage("已保存到浏览器本地存储。聊天页后续请求会自动使用这组配置。");
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(15,23,42,0.12),_transparent_26%),linear-gradient(180deg,_#f3ede4_0%,_#ece2d4_55%,_#e7d8c2_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="flex flex-col gap-4 rounded-[2rem] border border-black/10 bg-white/70 p-6 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                System Settings
              </p>
              <h1 className="text-3xl font-semibold">模型供应商配置</h1>
              <p className="max-w-2xl text-sm leading-7 text-slate-600">
                这里配置的是一个 OpenAI 兼容的 Chat Completions 供应商。
                目前为了保持项目简单，设置会保存在当前浏览器的
                `localStorage`，聊天请求时再安全地发给本地服务端。
              </p>
            </div>

            <Link
              href="/"
              className="inline-flex rounded-full border border-black/10 px-4 py-2 text-sm text-slate-700 transition hover:bg-black/5"
            >
              返回聊天页
            </Link>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
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
                <p className="mt-2 text-xs leading-6 text-slate-500">
                  填 API 基础路径，通常以 `/v1` 结尾，不要直接填
                  `/chat/completions`。
                </p>
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
                <select
                  value={form.model}
                  onChange={(event) => updateField("model", event.target.value)}
                  className="w-full rounded-2xl border border-black/10 bg-stone-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-300 focus:bg-white"
                >
                  <option value="">
                    {models.length > 0
                      ? "请选择模型"
                      : "等待自动拉取 models 列表"}
                  </option>
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                {fetchState.status === "loading" ? (
                  <p className="mt-2 text-xs leading-6 text-slate-500">
                    正在通过 `/models` 自动拉取模型列表...
                  </p>
                ) : null}
                {fetchState.status === "error" ? (
                  <p className="mt-2 text-xs leading-6 text-red-600">
                    {fetchState.error}
                  </p>
                ) : null}
                {fetchState.status === "success" && models.length > 0 ? (
                  <p className="mt-2 text-xs leading-6 text-emerald-700">
                    已自动拉取到 {models.length} 个模型，可直接选择。
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 border-t border-black/10 pt-5 md:flex-row md:items-center md:justify-between">
              <p className="text-xs leading-6 text-slate-500">
                这是本地教学项目，所以目前配置保存在浏览器本地，而不是数据库。
              </p>
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

          <aside className="space-y-5 rounded-[2rem] border border-black/10 bg-black/[0.04] p-6">
            <section className="rounded-[1.6rem] border border-black/10 bg-white/80 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-600">
                当前行为
              </h2>
              <ul className="mt-3 space-y-2 text-sm leading-7 text-slate-700">
                <li>1. 输入 `base URL` 和 `API Key` 后自动调用 `/api/models`</li>
                <li>2. 服务端代理请求 `${"{baseURL}"}/models`</li>
                <li>3. 返回模型列表并自动填充下拉框</li>
                <li>4. 保存后，聊天页发送请求时会附带这组配置</li>
              </ul>
            </section>

            <section className="rounded-[1.6rem] border border-black/10 bg-slate-950 p-4 text-slate-100">
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-orange-200">
                兼容性约束
              </h2>
              <div className="mt-3 space-y-2 text-sm leading-7 text-slate-300">
                <p>当前默认按 OpenAI 兼容的 `/models` 和 Chat Completions 语义工作。</p>
                <p>如果供应商不提供 `/models`，模型列表就无法自动拉取。</p>
                <p>如果某些模型不支持工具调用，聊天时会直接在服务端报错。</p>
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
