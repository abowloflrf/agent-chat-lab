"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { builtInTools } from "@/lib/built-in-tools";
import { ModuleSwitcher } from "@/components/module-switcher";
import {
  defaultProviderSettings,
  defaultSystemSettings,
  providerProtocolLabels,
  providerProtocols,
  type McpServer,
  type ProviderModel,
  type ProviderProtocol,
  type ProviderSettings,
  type SystemSettings,
} from "@/lib/provider-config";

type FetchModelsState =
  | { status: "idle"; error: string | null }
  | { status: "loading"; error: string | null }
  | { status: "success"; error: string | null }
  | { status: "error"; error: string };

type SettingsSection = "model" | "tools";

function generateId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
}

function createProvider(): ProviderSettings {
  return {
    ...defaultProviderSettings,
    id: generateId(),
    isDefault: false,
    models: [],
  };
}

function createModel(modelId: string): ProviderModel {
  return {
    id: generateId(),
    modelId,
    isEnabled: true,
    isDefault: false,
  };
}

function createMcpServer(): McpServer {
  return {
    id: generateId(),
    name: "",
    url: "",
    headers: [],
    isEnabled: true,
  };
}

const inputClass =
  "w-full rounded-lg border border-[rgba(23,23,23,0.12)] bg-[rgba(255,255,255,0.72)] px-4 py-3 text-sm text-[#171717] outline-none transition placeholder:text-[#a39a90] focus:border-[rgba(201,106,43,0.45)] focus:bg-white";
const labelClass = "mb-2 block text-[11px] uppercase tracking-[0.22em] text-[#8d8478]";

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        style={{ WebkitTextSecurity: visible ? "none" : "disc" } as React.CSSProperties}
        className={inputClass + " pr-20"}
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {/* Toggle visibility */}
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="rounded p-1.5 text-[#a39a90] transition hover:bg-[rgba(23,23,23,0.06)] hover:text-[#6e665d]"
          title={visible ? "隐藏" : "显示"}
        >
          {visible ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
        {/* Copy to clipboard */}
        <button
          type="button"
          onClick={handleCopy}
          className="rounded p-1.5 text-[#a39a90] transition hover:bg-[rgba(23,23,23,0.06)] hover:text-[#6e665d]"
          title="复制"
        >
          {copied ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

export function ProviderSettingsForm() {
  const [settings, setSettings] = useState<SystemSettings>(defaultSystemSettings);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [expandedMcpServerId, setExpandedMcpServerId] = useState<string | null>(null);
  const [fetchStates, setFetchStates] = useState<Record<string, FetchModelsState>>({});
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});
  const [addingModelForProvider, setAddingModelForProvider] = useState<string | null>(null);
  const [newModelId, setNewModelId] = useState("");
  const [toolUsageCounts, setToolUsageCounts] = useState<Record<string, number>>({});
  const [tavilyUsage, setTavilyUsage] = useState<{
    usage: number;
    limit: number | null;
    plan: string;
    searchUsage: number;
    extractUsage: number;
  } | null>(null);
  const [tavilyUsageLoading, setTavilyUsageLoading] = useState(false);
  const [tavilyUsageError, setTavilyUsageError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("model");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const initialLoadDone = useRef(false);

  // Load settings from server
  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const response = await fetch("/api/settings");
        const payload = (await response.json()) as { settings?: SystemSettings };

        if (!response.ok || cancelled) {
          return;
        }

        const loaded = payload.settings ?? defaultSystemSettings;
        setSettings(loaded);

        // Auto-expand the default or first provider
        const defaultProvider = loaded.providers.find((p) => p.isDefault) ?? loaded.providers[0];
        if (defaultProvider) {
          setExpandedProviderId(defaultProvider.id);
        }
      } catch {
        if (!cancelled) {
          setSettings(defaultSystemSettings);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          initialLoadDone.current = true;
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load tool usage counts
  useEffect(() => {
    let cancelled = false;

    async function loadToolUsageCounts() {
      try {
        const response = await fetch("/api/tool-stats");
        const payload = (await response.json()) as { counts?: Record<string, number> };

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

  // Load Tavily API usage when switching to tools section
  useEffect(() => {
    if (activeSection !== "tools" || !settings.tavilyApiKey) {
      return;
    }

    let cancelled = false;

    async function loadTavilyUsage() {
      setTavilyUsageLoading(true);
      setTavilyUsageError(null);

      try {
        const response = await fetch("/api/tavily-usage");
        const payload = await response.json();

        if (!response.ok || cancelled) {
          if (!cancelled) {
            setTavilyUsageError(payload.error ?? "查询失败");
          }
          return;
        }

        const data = payload.usage;
        setTavilyUsage({
          usage: data?.account?.plan_usage ?? data?.key?.usage ?? 0,
          limit: data?.account?.plan_limit ?? data?.key?.limit ?? null,
          plan: data?.account?.current_plan ?? "Unknown",
          searchUsage: data?.key?.search_usage ?? 0,
          extractUsage: data?.key?.extract_usage ?? 0,
        });
      } catch {
        if (!cancelled) {
          setTavilyUsageError("无法连接 Tavily API");
        }
      } finally {
        if (!cancelled) {
          setTavilyUsageLoading(false);
        }
      }
    }

    void loadTavilyUsage();

    return () => {
      cancelled = true;
    };
  }, [activeSection, settings.tavilyApiKey]);

  function updateProvider(providerId: string, updates: Partial<ProviderSettings>) {
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((p) =>
        p.id === providerId ? { ...p, ...updates } : p,
      ),
    }));
  }

  function setDefaultProvider(providerId: string) {
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((p) => ({
        ...p,
        isDefault: p.id === providerId,
      })),
    }));
  }

  function addProvider() {
    const newProvider = createProvider();
    setSettings((current) => ({
      ...current,
      providers: [...current.providers, newProvider],
    }));
    setExpandedProviderId(newProvider.id);
  }

  function removeProvider(providerId: string) {
    setSettings((current) => {
      const next = current.providers.filter((p) => p.id !== providerId);
      // If we removed the default, make the first enabled one default
      if (next.length > 0 && !next.some((p) => p.isDefault)) {
        const firstEnabled = next.find((p) => p.isEnabled) ?? next[0];
        return {
          ...current,
          providers: next.map((p) => ({
            ...p,
            isDefault: p.id === firstEnabled.id,
          })),
        };
      }
      return { ...current, providers: next };
    });
    if (expandedProviderId === providerId) {
      setExpandedProviderId(null);
    }
  }

  function updateMcpServer(serverId: string, updates: Partial<McpServer>) {
    setSettings((current) => ({
      ...current,
      mcpServers: current.mcpServers.map((server) =>
        server.id === serverId ? { ...server, ...updates } : server,
      ),
    }));
  }

  function addMcpServer() {
    const newServer = createMcpServer();
    setSettings((current) => ({
      ...current,
      mcpServers: [...current.mcpServers, newServer],
    }));
    setExpandedMcpServerId(newServer.id);
  }

  function removeMcpServer(serverId: string) {
    setSettings((current) => ({
      ...current,
      mcpServers: current.mcpServers.filter((server) => server.id !== serverId),
    }));
    if (expandedMcpServerId === serverId) {
      setExpandedMcpServerId(null);
    }
  }

  function addMcpHeader(serverId: string) {
    setSettings((current) => ({
      ...current,
      mcpServers: current.mcpServers.map((server) =>
        server.id === serverId
          ? { ...server, headers: [...server.headers, { key: "", value: "" }] }
          : server,
      ),
    }));
  }

  function updateMcpHeader(
    serverId: string,
    index: number,
    updates: Partial<McpServer["headers"][number]>,
  ) {
    setSettings((current) => ({
      ...current,
      mcpServers: current.mcpServers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              headers: server.headers.map((header, i) =>
                i === index ? { ...header, ...updates } : header,
              ),
            }
          : server,
      ),
    }));
  }

  function removeMcpHeader(serverId: string, index: number) {
    setSettings((current) => ({
      ...current,
      mcpServers: current.mcpServers.map((server) =>
        server.id === serverId
          ? { ...server, headers: server.headers.filter((_, i) => i !== index) }
          : server,
      ),
    }));
  }

  function addModelToProvider(providerId: string, modelId: string) {
    if (!modelId.trim()) return;
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((p) => {
        if (p.id !== providerId) return p;
        // Skip if already exists
        if (p.models.some((m) => m.modelId === modelId.trim())) return p;
        const newModel = createModel(modelId.trim());
        const isFirst = p.models.length === 0;
        return {
          ...p,
          models: [...p.models, { ...newModel, isDefault: isFirst }],
        };
      }),
    }));
  }

  function removeModelFromProvider(providerId: string, modelId: string) {
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((p) => {
        if (p.id !== providerId) return p;
        const next = p.models.filter((m) => m.id !== modelId);
        // If we removed the default, make the first enabled one default
        if (next.length > 0 && !next.some((m) => m.isDefault)) {
          const firstEnabled = next.find((m) => m.isEnabled) ?? next[0];
          return {
            ...p,
            models: next.map((m) => ({ ...m, isDefault: m.id === firstEnabled.id })),
          };
        }
        return { ...p, models: next };
      }),
    }));
  }

  function toggleModelEnabled(providerId: string, modelId: string) {
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((p) => {
        if (p.id !== providerId) return p;
        return {
          ...p,
          models: p.models.map((m) =>
            m.id === modelId ? { ...m, isEnabled: !m.isEnabled } : m,
          ),
        };
      }),
    }));
  }

  function setDefaultModel(providerId: string, modelId: string) {
    setSettings((current) => ({
      ...current,
      providers: current.providers.map((p) => {
        if (p.id !== providerId) return p;
        return {
          ...p,
          models: p.models.map((m) => ({
            ...m,
            isDefault: m.id === modelId,
          })),
        };
      }),
    }));
  }

  function fetchModelsForProvider(provider: ProviderSettings) {
    if (!provider.baseUrl.trim() || !provider.apiKey.trim()) return;

    setFetchStates((prev) => ({
      ...prev,
      [provider.id]: { status: "loading", error: null },
    }));

    fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerConfig: {
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
        },
      }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { models?: string[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error || "拉取模型失败。");
        }
        const models = payload.models ?? [];
        setFetchedModels((prev) => ({ ...prev, [provider.id]: models }));
        setFetchStates((prev) => ({
          ...prev,
          [provider.id]: { status: "success", error: null },
        }));
      })
      .catch((error) => {
        setFetchStates((prev) => ({
          ...prev,
          [provider.id]: {
            status: "error",
            error: error instanceof Error ? error.message : "拉取模型时发生未知错误。",
          },
        }));
      });
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      const payload = (await response.json()) as { settings?: SystemSettings; error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "保存失败。");
      }

      if (payload.settings) {
        setSettings(payload.settings);
      }

      setSaveMessage({ type: "success", text: "设置已保存。" });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      setSaveMessage({
        type: "error",
        text: error instanceof Error ? error.message : "保存设置时发生未知错误。",
      });
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <main className="app-shell flex h-full items-center justify-center text-[#171717]">
        <p className="text-sm text-[#8a8176]">加载设置中...</p>
      </main>
    );
  }

  return (
    <main className="app-shell h-full overflow-hidden text-[#171717]">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="dark-panel rise-in relative hidden h-full overflow-hidden border-r border-white/10 p-4 pt-[max(1rem,env(safe-area-inset-top))] lg:block">
          <div className="relative flex h-full flex-col">
            <div className="border-b border-white/8 pb-4">
              <ModuleSwitcher />
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
          {/* Mobile header for settings */}
          <div className="flex items-center gap-3 border-b border-[rgba(23,23,23,0.08)] px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
            <Link
              href="/"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(23,23,23,0.1)] text-[#5c544a] transition hover:bg-[rgba(23,23,23,0.04)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </Link>
            <p className="text-lg font-semibold tracking-[-0.02em] text-[#241c15]">系统设置</p>
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={() => setActiveSection("model")}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  activeSection === "model"
                    ? "bg-[#171717] text-white"
                    : "bg-[rgba(23,23,23,0.06)] text-[#5c544a]"
                }`}
              >
                模型
              </button>
              <button
                type="button"
                onClick={() => setActiveSection("tools")}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  activeSection === "tools"
                    ? "bg-[#171717] text-white"
                    : "bg-[rgba(23,23,23,0.06)] text-[#5c544a]"
                }`}
              >
                Tools
              </button>
            </div>
          </div>

          <div className="hidden border-b border-[rgba(23,23,23,0.08)] px-4 py-4 lg:block">
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#8a8176]">
              System Settings
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <form onSubmit={handleSave} className="max-w-3xl space-y-6">
              {activeSection === "model" ? (
                <>
                  <section className="pt-0">
                    <div className="mb-5">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                        模型配置
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[#6e665d]">
                        管理多个供应商，每个供应商可配置多个模型。设置将持久化到服务端数据库。
                      </p>
                    </div>

                    <div className="space-y-3">
                      {settings.providers.map((provider) => {
                        const isExpanded = expandedProviderId === provider.id;
                        const providerFetchState = fetchStates[provider.id] ?? { status: "idle", error: null };
                        const providerModels = fetchedModels[provider.id] ?? [];
                        const enabledModelCount = provider.models.filter((m) => m.isEnabled).length;

                        return (
                          <div
                            key={provider.id}
                            className={`rounded-lg border transition ${
                              isExpanded
                                ? "border-[rgba(201,106,43,0.3)] bg-[rgba(255,255,255,0.8)]"
                                : "border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.64)]"
                            }`}
                          >
                            {/* Provider header */}
                            <div
                              className="flex cursor-pointer items-center gap-3 px-4 py-3"
                              onClick={() => setExpandedProviderId(isExpanded ? null : provider.id)}
                            >
                              <span className="text-xs text-[#8a8176]">{isExpanded ? "▼" : "▶"}</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-[#241c15]">
                                    {provider.name}
                                  </span>
                                  {provider.isDefault && (
                                    <span className="rounded-full bg-[#9c5626]/10 px-2 py-0.5 text-[10px] font-medium text-[#9c5626]">
                                      默认
                                    </span>
                                  )}
                                  {!provider.isEnabled && (
                                    <span className="rounded-full bg-[#8a8176]/10 px-2 py-0.5 text-[10px] text-[#8a8176]">
                                      已禁用
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 truncate text-xs text-[#8a8176]">
                                  {provider.baseUrl} · {enabledModelCount} 个已启用模型
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeProvider(provider.id);
                                }}
                                className="shrink-0 rounded-md px-2 py-1 text-xs text-[#8a8176] transition hover:bg-red-50 hover:text-red-600"
                                title="删除供应商"
                              >
                                删除
                              </button>
                            </div>

                            {/* Expanded content */}
                            {isExpanded && (
                              <div className="border-t border-[rgba(23,23,23,0.06)] px-4 py-4">
                                <div className="grid gap-5">
                                  {/* Provider name */}
                                  <label className="block">
                                    <span className={labelClass}>名称</span>
                                    <input
                                      value={provider.name}
                                      onChange={(e) => updateProvider(provider.id, { name: e.target.value })}
                                      placeholder="OpenAI Compatible"
                                      className={inputClass}
                                    />
                                  </label>

                                  {/* Base URL */}
                                  <label className="block">
                                    <span className={labelClass}>Base URL</span>
                                    <input
                                      value={provider.baseUrl}
                                      onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
                                      placeholder="https://api.openai.com/v1"
                                      className={inputClass}
                                    />
                                  </label>

                                  {/* API Key */}
                                  <label className="block">
                                    <span className={labelClass}>API Key</span>
                                    <SecretInput
                                      value={provider.apiKey}
                                      onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                                      placeholder="sk-..."
                                    />
                                  </label>

                                  {/* Protocol */}
                                  <label className="block">
                                    <span className={labelClass}>协议</span>
                                    <select
                                      value={provider.protocol}
                                      onChange={(e) =>
                                        updateProvider(provider.id, {
                                          protocol: e.target.value as ProviderProtocol,
                                        })
                                      }
                                      className={inputClass}
                                    >
                                      {providerProtocols.map((p) => (
                                        <option key={p} value={p}>
                                          {providerProtocolLabels[p]}
                                        </option>
                                      ))}
                                    </select>
                                  </label>

                                  {/* Toggle row */}
                                  <div className="flex flex-wrap items-center gap-4">
                                    <label className="flex items-center gap-2 text-sm text-[#4d4339]">
                                      <input
                                        type="checkbox"
                                        checked={provider.isEnabled}
                                        onChange={(e) => updateProvider(provider.id, { isEnabled: e.target.checked })}
                                        className="accent-[#9c5626]"
                                      />
                                      启用
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => setDefaultProvider(provider.id)}
                                      disabled={provider.isDefault}
                                      className={`rounded-full border px-3 py-1 text-xs transition ${
                                        provider.isDefault
                                          ? "border-[#9c5626]/30 bg-[#9c5626]/10 text-[#9c5626]"
                                          : "border-[rgba(23,23,23,0.12)] text-[#6e665d] hover:border-[#9c5626]/30 hover:text-[#9c5626]"
                                      }`}
                                    >
                                      {provider.isDefault ? "默认供应商" : "设为默认"}
                                    </button>
                                  </div>

                                  {/* Models section */}
                                  <div>
                                    <div className="mb-3 flex items-center justify-between">
                                      <span className={labelClass}>模型列表</span>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => fetchModelsForProvider(provider)}
                                          disabled={!provider.baseUrl.trim() || !provider.apiKey.trim() || providerFetchState.status === "loading"}
                                          className="text-[11px] text-[#9c5626] transition hover:text-[#a44d16] disabled:opacity-50"
                                        >
                                          {providerFetchState.status === "loading" ? "拉取中..." : "从 API 拉取"}
                                        </button>
                                      </div>
                                    </div>

                                    {providerFetchState.status === "error" && (
                                      <p className="mb-2 text-xs text-red-500">
                                        {providerFetchState.error}
                                      </p>
                                    )}

                                    {/* Fetched models selector */}
                                    {providerFetchState.status === "success" && providerModels.length > 0 && (
                                      <div className="mb-3">
                                        <select
                                          onChange={(e) => {
                                            if (e.target.value) {
                                              addModelToProvider(provider.id, e.target.value);
                                              e.target.value = "";
                                            }
                                          }}
                                          className={inputClass}
                                          defaultValue=""
                                        >
                                          <option value="">从已拉取的模型中选择添加...</option>
                                          {providerModels
                                            .filter((m) => !provider.models.some((pm) => pm.modelId === m))
                                            .map((m) => (
                                              <option key={m} value={m}>{m}</option>
                                            ))}
                                        </select>
                                      </div>
                                    )}

                                    {/* Added models list */}
                                    {provider.models.length > 0 && (
                                      <div className="mb-3 space-y-1.5">
                                        {provider.models.map((model) => (
                                          <div
                                            key={model.id}
                                            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                                              model.isEnabled
                                                ? "border-[rgba(23,23,23,0.08)] bg-[rgba(248,242,235,0.6)]"
                                                : "border-[rgba(23,23,23,0.06)] bg-[rgba(248,242,235,0.3)] opacity-60"
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={model.isEnabled}
                                              onChange={() => toggleModelEnabled(provider.id, model.id)}
                                              className="accent-[#9c5626]"
                                            />
                                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#241c15]">
                                              {model.modelId}
                                            </span>
                                            {model.isDefault && (
                                              <span className="shrink-0 rounded-full bg-[#9c5626]/10 px-2 py-0.5 text-[10px] font-medium text-[#9c5626]">
                                                默认
                                              </span>
                                            )}
                                            {!model.isDefault && (
                                              <button
                                                type="button"
                                                onClick={() => setDefaultModel(provider.id, model.id)}
                                                className="shrink-0 text-[10px] text-[#8a8176] transition hover:text-[#9c5626]"
                                              >
                                                设为默认
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => removeModelFromProvider(provider.id, model.id)}
                                              className="shrink-0 text-[10px] text-[#8a8176] transition hover:text-red-500"
                                            >
                                              移除
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {/* Manual add model */}
                                    {addingModelForProvider === provider.id ? (
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="text"
                                          value={newModelId}
                                          onChange={(e) => setNewModelId(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              if (newModelId.trim()) {
                                                addModelToProvider(provider.id, newModelId);
                                                setNewModelId("");
                                                setAddingModelForProvider(null);
                                              }
                                            }
                                            if (e.key === "Escape") {
                                              setNewModelId("");
                                              setAddingModelForProvider(null);
                                            }
                                          }}
                                          placeholder="输入模型名称，如 gpt-4o"
                                          className={inputClass}
                                          autoFocus
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (newModelId.trim()) {
                                              addModelToProvider(provider.id, newModelId);
                                              setNewModelId("");
                                              setAddingModelForProvider(null);
                                            }
                                          }}
                                          className="shrink-0 rounded-md border border-[rgba(23,23,23,0.12)] px-3 py-3 text-xs text-[#4d4339] transition hover:border-[#9c5626]/30 hover:text-[#9c5626]"
                                        >
                                          添加
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setNewModelId("");
                                            setAddingModelForProvider(null);
                                          }}
                                          className="shrink-0 rounded-md px-2 py-3 text-xs text-[#8a8176] transition hover:text-[#4d4339]"
                                        >
                                          取消
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setAddingModelForProvider(provider.id);
                                          setNewModelId("");
                                        }}
                                        className="text-xs text-[#9c5626] transition hover:text-[#a44d16]"
                                      >
                                        + 手动添加模型
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Add provider button */}
                    <button
                      type="button"
                      onClick={addProvider}
                      className="mt-3 rounded-lg border border-dashed border-[rgba(23,23,23,0.16)] px-4 py-3 text-sm text-[#6e665d] transition hover:border-[rgba(201,106,43,0.45)] hover:text-[#9c5626]"
                    >
                      + 添加供应商
                    </button>
                  </section>

                  {/* Save bar */}
                  <div className="flex items-center justify-end gap-3 border-t border-[rgba(23,23,23,0.08)] pt-5">
                    {saveMessage && (
                      <span
                        className={`text-xs ${
                          saveMessage.type === "success" ? "text-green-600" : "text-red-500"
                        }`}
                      >
                        {saveMessage.text}
                      </span>
                    )}
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="rounded-full bg-[#171717] px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-white transition hover:bg-[#2b241d] disabled:opacity-50"
                    >
                      {isSaving ? "保存中..." : "保存"}
                    </button>
                  </div>
                </>
              ) : (
                <section className="pt-0">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                        内置 Tools
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-[rgba(23,23,23,0.1)] px-3 py-1 text-[11px] leading-none text-[#6e665d]">
                      {builtInTools.length} 个
                    </span>
                  </div>

                  <div className="mb-5 rounded-lg border border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.72)] p-4">
                    <label className="block">
                      <span className={labelClass}>Tavily API Key</span>
                      <SecretInput
                        value={settings.tavilyApiKey}
                        onChange={(e) =>
                          setSettings((current) => ({
                            ...current,
                            tavilyApiKey: e.target.value,
                          }))
                        }
                        placeholder="tvly-..."
                      />
                    </label>
                    <p className="mt-2 text-xs leading-5 text-[#8a8176]">
                      `WebSearch` 会在需要联网查询最新网页信息时自动调用。未填写时，服务端会回退到环境变量 `TAVILY_API_KEY`。
                    </p>

                    {/* Tavily Usage Progress Bar */}
                    {settings.tavilyApiKey && (
                      <div className="mt-4 rounded-lg border border-[rgba(23,23,23,0.06)] bg-[rgba(245,241,237,0.5)] p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] uppercase tracking-[0.18em] text-[#8d8478]">
                            API 用量
                          </span>
                          {tavilyUsage && (
                            <span className="rounded-full border border-[rgba(23,23,23,0.08)] bg-white px-2 py-0.5 text-[10px] text-[#6e665d]">
                              {tavilyUsage.plan}
                            </span>
                          )}
                        </div>

                        {tavilyUsageLoading && (
                          <p className="mt-2 text-xs text-[#8a8176]">查询中...</p>
                        )}

                        {tavilyUsageError && (
                          <p className="mt-2 text-xs text-red-500">{tavilyUsageError}</p>
                        )}

                        {tavilyUsage && !tavilyUsageLoading && (
                          <>
                            <div className="mt-2 flex items-baseline justify-between">
                              <span className="text-sm font-medium text-[#4d4339]">
                                {tavilyUsage.usage.toLocaleString()}
                                {tavilyUsage.limit != null && (
                                  <span className="text-[#8a8176]">
                                    {" "}/ {tavilyUsage.limit.toLocaleString()} credits
                                  </span>
                                )}
                              </span>
                              {tavilyUsage.limit != null && tavilyUsage.limit > 0 && (
                                <span className="text-xs text-[#8a8176]">
                                  {Math.round((tavilyUsage.usage / tavilyUsage.limit) * 100)}%
                                </span>
                              )}
                            </div>

                            {tavilyUsage.limit != null && tavilyUsage.limit > 0 && (
                              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[rgba(23,23,23,0.06)]">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    tavilyUsage.usage / tavilyUsage.limit > 0.9
                                      ? "bg-red-400"
                                      : tavilyUsage.usage / tavilyUsage.limit > 0.7
                                        ? "bg-amber-400"
                                        : "bg-[#c96a2b]"
                                  }`}
                                  style={{
                                    width: `${Math.min(100, (tavilyUsage.usage / tavilyUsage.limit) * 100)}%`,
                                  }}
                                />
                              </div>
                            )}

                            <div className="mt-2 flex gap-3 text-[11px] text-[#8a8176]">
                              <span>Search: {tavilyUsage.searchUsage}</span>
                              <span>Extract: {tavilyUsage.extractUsage}</span>
                            </div>

                            <p className="mt-2 text-[11px] text-[#a39a90]">
                              额度按账单周期重置，具体时间请查看{" "}
                              <a
                                href="https://app.tavily.com/home"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline transition hover:text-[#c96a2b]"
                              >
                                Tavily Dashboard
                              </a>
                            </p>
                          </>
                        )}
                      </div>
                    )}
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

                  {/* MCP Servers */}
                  <div className="mt-8">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-[#8d8478]">
                        MCP Servers
                      </p>
                      <span className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-[rgba(23,23,23,0.1)] px-3 py-1 text-[11px] leading-none text-[#6e665d]">
                        {settings.mcpServers.length} 个
                      </span>
                    </div>
                    <p className="mb-4 text-xs leading-5 text-[#8a8176]">
                      通过 Streamable HTTP 接入远程 MCP Server，其工具会在对话中自动可用。启用的 Server 会在每次请求时连接；某个 Server 连接失败会被跳过，不影响其余对话。
                    </p>

                    {settings.mcpServers.length > 0 && (
                      <div className="space-y-2">
                        {settings.mcpServers.map((server) => {
                          const isExpanded = expandedMcpServerId === server.id;
                          return (
                            <div
                              key={server.id}
                              className={`rounded-lg border ${
                                server.isEnabled
                                  ? "border-[rgba(23,23,23,0.08)] bg-[rgba(255,255,255,0.64)]"
                                  : "border-[rgba(23,23,23,0.06)] bg-[rgba(255,255,255,0.4)] opacity-70"
                              }`}
                            >
                              <div className="flex items-center gap-3 px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedMcpServerId(isExpanded ? null : server.id)
                                  }
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                >
                                  <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className={`shrink-0 text-[#a39a90] transition-transform ${
                                      isExpanded ? "rotate-90" : ""
                                    }`}
                                  >
                                    <polyline points="9 18 15 12 9 6" />
                                  </svg>
                                  <span className="shrink-0 truncate text-sm font-medium text-[#241c15]">
                                    {server.name || "未命名 Server"}
                                  </span>
                                  {server.url && (
                                    <span className="min-w-0 truncate font-mono text-[11px] text-[#a39a90]">
                                      {server.url}
                                    </span>
                                  )}
                                </button>
                                <label className="flex shrink-0 items-center gap-1.5 text-xs text-[#6e665d]">
                                  <input
                                    type="checkbox"
                                    checked={server.isEnabled}
                                    onChange={(e) =>
                                      updateMcpServer(server.id, {
                                        isEnabled: e.target.checked,
                                      })
                                    }
                                    className="accent-[#9c5626]"
                                  />
                                  启用
                                </label>
                                <button
                                  type="button"
                                  onClick={() => removeMcpServer(server.id)}
                                  className="shrink-0 text-[11px] text-[#8a8176] transition hover:text-red-500"
                                >
                                  删除
                                </button>
                              </div>

                              {isExpanded && (
                                <div className="space-y-4 border-t border-[rgba(23,23,23,0.08)] px-4 py-4">
                                  <label className="block">
                                    <span className={labelClass}>名称</span>
                                    <input
                                      type="text"
                                      value={server.name}
                                      onChange={(e) =>
                                        updateMcpServer(server.id, { name: e.target.value })
                                      }
                                      placeholder="如 GitHub MCP"
                                      className={inputClass}
                                    />
                                  </label>

                                  <label className="block">
                                    <span className={labelClass}>Server URL</span>
                                    <input
                                      type="text"
                                      value={server.url}
                                      onChange={(e) =>
                                        updateMcpServer(server.id, { url: e.target.value })
                                      }
                                      placeholder="https://example.com/mcp"
                                      className={inputClass}
                                    />
                                  </label>

                                  <div>
                                    <div className="mb-2 flex items-center justify-between">
                                      <span className={labelClass}>请求 Headers</span>
                                      <button
                                        type="button"
                                        onClick={() => addMcpHeader(server.id)}
                                        className="text-[11px] text-[#9c5626] transition hover:text-[#a44d16]"
                                      >
                                        + 添加 Header
                                      </button>
                                    </div>

                                    {server.headers.length === 0 ? (
                                      <p className="text-xs text-[#a39a90]">
                                        无需鉴权可留空；如需鉴权可添加 Authorization 等 Header。
                                      </p>
                                    ) : (
                                      <div className="space-y-2">
                                        {server.headers.map((header, index) => (
                                          <div key={index} className="flex items-start gap-2">
                                            <div className="min-w-0 flex-1">
                                              <input
                                                type="text"
                                                value={header.key}
                                                onChange={(e) =>
                                                  updateMcpHeader(server.id, index, {
                                                    key: e.target.value,
                                                  })
                                                }
                                                placeholder="Header 名，如 Authorization"
                                                className={inputClass}
                                              />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <SecretInput
                                                value={header.value}
                                                onChange={(e) =>
                                                  updateMcpHeader(server.id, index, {
                                                    value: e.target.value,
                                                  })
                                                }
                                                placeholder="Header 值，如 Bearer xxx"
                                              />
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => removeMcpHeader(server.id, index)}
                                              className="shrink-0 px-1 py-3 text-[11px] text-[#8a8176] transition hover:text-red-500"
                                            >
                                              移除
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={addMcpServer}
                      className="mt-3 rounded-lg border border-dashed border-[rgba(23,23,23,0.16)] px-4 py-3 text-sm text-[#6e665d] transition hover:border-[rgba(201,106,43,0.45)] hover:text-[#9c5626]"
                    >
                      + 添加 MCP Server
                    </button>
                  </div>

                  <div className="mt-6 flex items-center justify-end gap-3 border-t border-[rgba(23,23,23,0.08)] pt-5">
                    {saveMessage && (
                      <span
                        className={`text-xs ${
                          saveMessage.type === "success" ? "text-green-600" : "text-red-500"
                        }`}
                      >
                        {saveMessage.text}
                      </span>
                    )}
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="rounded-full bg-[#171717] px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-white transition hover:bg-[#2b241d] disabled:opacity-50"
                    >
                      {isSaving ? "保存中..." : "保存"}
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
