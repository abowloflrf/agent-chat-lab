"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { builtInTools } from "@/lib/built-in-tools";
import { ModuleSwitcher } from "@/components/module-switcher";
import { StatsDashboard } from "@/components/stats-dashboard";
import { ConversationsManager } from "@/components/conversations-manager";
import { ThemeSelector } from "@/components/theme-selector";
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
import {
  defaultSettingsSection,
  isSettingsSection,
  settingsSections,
  settingsSectionLabels,
  type SettingsSection,
} from "@/lib/settings-sections";

type FetchModelsState =
  | { status: "idle"; error: string | null }
  | { status: "loading"; error: string | null }
  | { status: "success"; error: string | null }
  | { status: "error"; error: string };

type McpTestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; tools: Array<{ name: string; description: string }> }
  | { status: "error"; error: string };

type DiscoveredSkill = { name: string; description: string };

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
    authType: "header",
    oauthScopes: "",
    headers: [],
    isEnabled: true,
  };
}

type McpOAuthStatus = "unauthorized" | "pending" | "authorized" | "needs_reauth";
type McpOAuthInfo = { status: McpOAuthStatus; expiresAt: number | null };

const mcpOAuthBadge: Record<McpOAuthStatus, { label: string; dot: string; color: string }> = {
  unauthorized: { label: "未授权", dot: "○", color: "text-[var(--muted-foreground)]" },
  pending: { label: "授权进行中", dot: "◐", color: "text-[var(--muted-foreground)]" },
  authorized: { label: "已授权", dot: "●", color: "text-[var(--success)]" },
  needs_reauth: { label: "需重新授权", dot: "▲", color: "text-[var(--danger)]" },
};

// Coarse human-friendly remaining validity for the OAuth badge.
function formatMcpTokenRemaining(expiresAt: number | null): string {
  if (!expiresAt) return "";
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "已过期";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `约 ${Math.max(1, minutes)} 分钟后过期`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `约 ${hours} 小时后过期`;
  return `约 ${Math.floor(hours / 24)} 天后过期`;
}

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--glass-bg)] px-4 py-3 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted-foreground)] focus:border-[var(--accent)] focus:bg-[var(--background)]";
const labelClass = "mb-2 block text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]";

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
          className="rounded p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--border)] hover:text-[var(--muted-foreground)]"
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
          className="rounded p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--border)] hover:text-[var(--muted-foreground)]"
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
  const pathname = usePathname();
  const segment = pathname.split("/")[2] ?? "";
  const section: SettingsSection = isSettingsSection(segment)
    ? segment
    : defaultSettingsSection;
  const [settings, setSettings] = useState<SystemSettings>(defaultSystemSettings);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [expandedMcpServerId, setExpandedMcpServerId] = useState<string | null>(null);
  const [mcpTestStates, setMcpTestStates] = useState<Record<string, McpTestState>>({});
  const [mcpOAuthStatuses, setMcpOAuthStatuses] = useState<Record<string, McpOAuthInfo>>({});
  const [mcpAuthorizingId, setMcpAuthorizingId] = useState<string | null>(null);
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
  const [exaUsage, setExaUsage] = useState<{
    count: number;
    limit: number | null;
    costUsd: number;
    searchCount: number;
    contentsCount: number;
  } | null>(null);
  const [exaUsageLoading, setExaUsageLoading] = useState(false);
  const [exaUsageError, setExaUsageError] = useState<string | null>(null);
  const [skills, setSkills] = useState<DiscoveredSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
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
        const payload = (await response.json()) as {
          settings?: SystemSettings;
          mcpOAuth?: Record<string, McpOAuthInfo>;
        };

        if (!response.ok || cancelled) {
          return;
        }

        const loaded = payload.settings ?? defaultSystemSettings;
        setSettings(loaded);
        setMcpOAuthStatuses(payload.mcpOAuth ?? {});

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

  // Surface the OAuth callback result (set by /api/mcp/oauth/callback redirect),
  // expand the affected server, then strip the query so a refresh doesn't re-toast.
  useEffect(() => {
    async function handleOAuthResult() {
      const params = new URLSearchParams(window.location.search);
      const outcome = params.get("mcpOAuth");
      if (!outcome) return;

      const serverId = params.get("server");
      params.delete("mcpOAuth");
      params.delete("server");
      const query = params.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );

      // Defer state updates out of the synchronous effect body.
      await Promise.resolve();
      setSaveMessage(
        outcome === "success"
          ? { type: "success", text: "已完成 OAuth 授权。" }
          : { type: "error", text: "OAuth 授权失败，请重试。" },
      );
      if (serverId) setExpandedMcpServerId(serverId);
    }

    void handleOAuthResult();
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
    if (section !== "tools" || !settings.tavilyApiKey) {
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
  }, [section, settings.tavilyApiKey]);

  // Load Exa API usage (current calendar month) when viewing the tools section.
  // The usage service key is env-only (EXA_SERVICE_KEY), separate from the search key.
  useEffect(() => {
    if (section !== "tools" || !settings.exaApiKey) {
      return;
    }

    let cancelled = false;

    async function loadExaUsage() {
      setExaUsageLoading(true);
      setExaUsageError(null);

      try {
        const response = await fetch("/api/exa-usage");
        const payload = await response.json();

        if (!response.ok || cancelled) {
          if (!cancelled) {
            setExaUsageError(payload.error ?? "查询失败");
          }
          return;
        }

        const data = payload.usage;
        setExaUsage({
          count: data?.count ?? 0,
          limit: data?.limit ?? null,
          costUsd: data?.costUsd ?? 0,
          searchCount: data?.searchCount ?? 0,
          contentsCount: data?.contentsCount ?? 0,
        });
      } catch {
        if (!cancelled) {
          setExaUsageError("无法连接 Exa API");
        }
      } finally {
        if (!cancelled) {
          setExaUsageLoading(false);
        }
      }
    }

    void loadExaUsage();

    return () => {
      cancelled = true;
    };
  }, [section, settings.exaApiKey]);

  // Discover skills from the server when viewing the tools section. The skill
  // list lives on the filesystem (not in settings); only the on/off state does.
  useEffect(() => {
    if (section !== "tools") {
      return;
    }

    let cancelled = false;

    async function loadSkills() {
      setSkillsLoading(true);
      setSkillsError(null);

      try {
        const response = await fetch("/api/skills");
        const payload = (await response.json()) as {
          skills?: DiscoveredSkill[];
          error?: string;
        };

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setSkillsError(payload.error ?? "加载 Skills 失败");
          return;
        }

        setSkills(payload.skills ?? []);
      } catch {
        if (!cancelled) {
          setSkillsError("无法加载 Skills");
        }
      } finally {
        if (!cancelled) {
          setSkillsLoading(false);
        }
      }
    }

    void loadSkills();

    return () => {
      cancelled = true;
    };
  }, [section]);

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

  async function testMcpServerConnection(server: McpServer) {
    if (!server.url.trim()) return;

    setMcpTestStates((prev) => ({ ...prev, [server.id]: { status: "loading" } }));

    // OAuth tests run against the saved config + stored token, so persist the
    // draft first to keep the tested URL/scopes consistent with what's stored.
    if (server.authType === "oauth") {
      try {
        await persistSettings();
      } catch (error) {
        setMcpTestStates((prev) => ({
          ...prev,
          [server.id]: {
            status: "error",
            error: error instanceof Error ? error.message : "保存失败，无法测试。",
          },
        }));
        return;
      }
    }

    fetch("/api/mcp-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: server.id,
        name: server.name.trim() || undefined,
        url: server.url.trim(),
        authType: server.authType,
        oauthScopes: server.oauthScopes,
        headers: server.headers.filter((header) => header.key.trim()),
      }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          tools?: Array<{ name: string; description: string }>;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "连接失败。");
        }
        setMcpTestStates((prev) => ({
          ...prev,
          [server.id]: { status: "success", tools: payload.tools ?? [] },
        }));
      })
      .catch((error) => {
        setMcpTestStates((prev) => ({
          ...prev,
          [server.id]: {
            status: "error",
            error: error instanceof Error ? error.message : "连接失败。",
          },
        }));
      });
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

  function toggleSkillDisabled(name: string) {
    setSettings((current) => ({
      ...current,
      disabledSkills: current.disabledSkills.includes(name)
        ? current.disabledSkills.filter((item) => item !== name)
        : [...current.disabledSkills, name],
    }));
  }

  async function persistSettings(): Promise<void> {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    const payload = (await response.json()) as {
      settings?: SystemSettings;
      mcpOAuth?: Record<string, McpOAuthInfo>;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error || "保存失败。");
    }

    if (payload.settings) {
      setSettings(payload.settings);
    }
    // Keep OAuth badges in sync with server-side cleanup (e.g. a URL change or
    // switch-to-Header drops the session), avoiding a stale "authorized" badge.
    if (payload.mcpOAuth) {
      setMcpOAuthStatuses(payload.mcpOAuth);
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);

    try {
      await persistSettings();
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

  // Authorize an OAuth MCP server. Settings must be persisted first: the browser
  // redirects out to the authorization server and the in-memory draft would be
  // lost, so the start route reads the saved config by id.
  async function authorizeMcpServer(server: McpServer) {
    if (!server.url.trim() || mcpAuthorizingId) return;

    setMcpAuthorizingId(server.id);
    setSaveMessage(null);

    try {
      await persistSettings();

      const response = await fetch("/api/mcp/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: server.id }),
      });
      const payload = (await response.json()) as {
        authorizeUrl?: string | null;
        alreadyAuthorized?: boolean;
        expiresAt?: number | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "发起授权失败。");
      }

      if (payload.alreadyAuthorized) {
        setMcpOAuthStatuses((prev) => ({
          ...prev,
          [server.id]: {
            status: "authorized",
            expiresAt: payload.expiresAt ?? prev[server.id]?.expiresAt ?? null,
          },
        }));
        setSaveMessage({ type: "success", text: "该 Server 已授权。" });
        setMcpAuthorizingId(null);
        return;
      }

      if (payload.authorizeUrl) {
        // Leaves the page; the callback redirects back to /settings/tools.
        window.location.href = payload.authorizeUrl;
        return;
      }

      throw new Error("未能获取授权地址。");
    } catch (error) {
      setSaveMessage({
        type: "error",
        text: error instanceof Error ? error.message : "发起授权失败。",
      });
      setMcpAuthorizingId(null);
    }
  }

  if (isLoading) {
    return (
      <main className="app-shell flex h-full items-center justify-center text-[var(--foreground)]">
        <p className="text-sm text-[var(--muted-foreground)]">加载设置中...</p>
      </main>
    );
  }

  return (
    <main className="app-shell h-full overflow-hidden text-[var(--foreground)]">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="dark-panel rise-in relative hidden h-full overflow-hidden border-r border-white/10 p-4 pt-[max(1rem,env(safe-area-inset-top))] lg:block">
          <div className="relative flex h-full flex-col">
            <div className="border-b border-white/8 pb-4">
              <ModuleSwitcher />
            </div>

            <div className="pt-4">
              <div className="space-y-1 border-b border-white/8 pb-4">
                {settingsSections.map((item) => {
                  const active = section === item;
                  return (
                    <Link
                      key={item}
                      href={`/settings/${item}`}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-3 text-left transition ${
                        active
                          ? "border-white/16 bg-white/10 text-[var(--panel-foreground)]"
                          : "border-transparent text-[var(--panel-muted)] hover:border-white/10 hover:bg-white/6 hover:text-[var(--panel-foreground)]"
                      }`}
                    >
                      <span
                        className={`text-sm font-medium ${
                          active ? "text-[var(--panel-foreground)]" : "text-[var(--panel-muted)]"
                        }`}
                      >
                        {settingsSectionLabels[item].full}
                      </span>
                      <span className="text-xs">↗</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        <section className="glass-panel rise-in flex h-full min-h-0 flex-col overflow-hidden">
          {/* Mobile header for settings */}
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
            <Link
              href="/"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted-foreground)] transition hover:bg-[var(--border)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </Link>
            <p className="text-lg font-semibold tracking-[-0.02em] text-[var(--foreground)]">系统设置</p>
            <div className="ml-auto flex min-w-0 gap-1 overflow-x-auto scrollbar-hidden">
              {settingsSections.map((item) => {
                const active = section === item;
                return (
                  <Link
                    key={item}
                    href={`/settings/${item}`}
                    className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-foreground text-primary-foreground"
                        : "bg-[var(--border)] text-[var(--muted-foreground)]"
                    }`}
                  >
                    {settingsSectionLabels[item].short}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="hidden border-b border-[var(--border)] px-4 py-4 lg:block">
            <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--muted-foreground)]">
              System Settings
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {section === "appearance" ? (
              <div className="mx-auto w-full max-w-5xl">
                <ThemeSelector />
              </div>
            ) : section === "stats" ? (
              <div className="mx-auto w-full max-w-5xl">
                <StatsDashboard />
              </div>
            ) : section === "conversations" ? (
              <div className="mx-auto w-full max-w-5xl">
                <ConversationsManager />
              </div>
            ) : (
            <form onSubmit={handleSave} className="max-w-3xl space-y-6">
              {section === "model" ? (
                <>
                  <section className="pt-0">
                    <div className="mb-5">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
                        模型配置
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
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
                                ? "border-[var(--accent)] bg-[var(--glass-bg)]"
                                : "border-[var(--border)] bg-[var(--glass-bg)]"
                            }`}
                          >
                            {/* Provider header */}
                            <div
                              className="flex cursor-pointer items-center gap-3 px-4 py-3"
                              onClick={() => setExpandedProviderId(isExpanded ? null : provider.id)}
                            >
                              <span className="text-xs text-[var(--muted-foreground)]">{isExpanded ? "▼" : "▶"}</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-[var(--foreground)]">
                                    {provider.name}
                                  </span>
                                  {provider.isDefault && (
                                    <span className="rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                                      默认
                                    </span>
                                  )}
                                  {!provider.isEnabled && (
                                    <span className="rounded-full bg-[var(--muted-foreground)]/10 px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                                      已禁用
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
                                  {provider.baseUrl} · {enabledModelCount} 个已启用模型
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeProvider(provider.id);
                                }}
                                className="shrink-0 rounded-md px-2 py-1 text-xs text-[var(--muted-foreground)] transition hover:bg-[var(--danger-surface)] hover:text-[var(--danger)]"
                                title="删除供应商"
                              >
                                删除
                              </button>
                            </div>

                            {/* Expanded content */}
                            {isExpanded && (
                              <div className="border-t border-[var(--border)] px-4 py-4">
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
                                    <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                                      <input
                                        type="checkbox"
                                        checked={provider.isEnabled}
                                        onChange={(e) => updateProvider(provider.id, { isEnabled: e.target.checked })}
                                        className="accent-[var(--accent)]"
                                      />
                                      启用
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() => setDefaultProvider(provider.id)}
                                      disabled={provider.isDefault}
                                      className={`rounded-full border px-3 py-1 text-xs transition ${
                                        provider.isDefault
                                          ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]"
                                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
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
                                          className="text-[11px] text-[var(--accent)] transition hover:text-[var(--accent-strong)] disabled:opacity-50"
                                        >
                                          {providerFetchState.status === "loading" ? "拉取中..." : "从 API 拉取"}
                                        </button>
                                      </div>
                                    </div>

                                    {providerFetchState.status === "error" && (
                                      <p className="mb-2 text-xs text-[var(--danger)]">
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
                                                ? "border-[var(--border)] bg-[var(--glass-bg)]"
                                                : "border-[var(--border)] bg-[var(--glass-bg)] opacity-60"
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={model.isEnabled}
                                              onChange={() => toggleModelEnabled(provider.id, model.id)}
                                              className="accent-[var(--accent)]"
                                            />
                                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--foreground)]">
                                              {model.modelId}
                                            </span>
                                            {model.isDefault && (
                                              <span className="shrink-0 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                                                默认
                                              </span>
                                            )}
                                            {!model.isDefault && (
                                              <button
                                                type="button"
                                                onClick={() => setDefaultModel(provider.id, model.id)}
                                                className="shrink-0 text-[10px] text-[var(--muted-foreground)] transition hover:text-[var(--accent)]"
                                              >
                                                设为默认
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              onClick={() => removeModelFromProvider(provider.id, model.id)}
                                              className="shrink-0 text-[10px] text-[var(--muted-foreground)] transition hover:text-[var(--danger)]"
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
                                          className="shrink-0 rounded-md border border-[var(--border)] px-3 py-3 text-xs text-[var(--foreground)] transition hover:border-[var(--accent)]/30 hover:text-[var(--accent)]"
                                        >
                                          添加
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setNewModelId("");
                                            setAddingModelForProvider(null);
                                          }}
                                          className="shrink-0 rounded-md px-2 py-3 text-xs text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
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
                                        className="text-xs text-[var(--accent)] transition hover:text-[var(--accent-strong)]"
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
                      className="mt-3 rounded-lg border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      + 添加供应商
                    </button>
                  </section>

                  {/* Save bar */}
                  <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] pt-5">
                    {saveMessage && (
                      <span
                        className={`text-xs ${
                          saveMessage.type === "success" ? "text-[var(--success)]" : "text-[var(--danger)]"
                        }`}
                      >
                        {saveMessage.text}
                      </span>
                    )}
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="rounded-full bg-foreground px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-primary-foreground transition hover:bg-[var(--accent-strong)] disabled:opacity-50"
                    >
                      {isSaving ? "保存中..." : "保存"}
                    </button>
                  </div>
                </>
              ) : (
                <section className="pt-0">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
                        内置 Tools
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-[var(--border)] px-3 py-1 text-[11px] leading-none text-[var(--muted-foreground)]">
                      {builtInTools.length} 个
                    </span>
                  </div>

                  <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--glass-bg)] p-4">
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
                    <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                      `WebSearch` / `WebFetch` 会在需要联网时自动调用。若同时配置 Tavily 与 Exa，每次请求会在两者间随机分担、某家失败时自动回退；只配一个则始终用它。未填写时回退到环境变量 `TAVILY_API_KEY`。
                    </p>

                    {/* Tavily Usage Progress Bar */}
                    {settings.tavilyApiKey && (
                      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--glass-bg)] p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                            API 用量
                          </span>
                          {tavilyUsage && (
                            <span className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                              {tavilyUsage.plan}
                            </span>
                          )}
                        </div>

                        {tavilyUsageLoading && (
                          <p className="mt-2 text-xs text-[var(--muted-foreground)]">查询中...</p>
                        )}

                        {tavilyUsageError && (
                          <p className="mt-2 text-xs text-[var(--danger)]">{tavilyUsageError}</p>
                        )}

                        {tavilyUsage && !tavilyUsageLoading && (
                          <>
                            <div className="mt-2 flex items-baseline justify-between">
                              <span className="text-sm font-medium text-[var(--foreground)]">
                                {tavilyUsage.usage.toLocaleString()}
                                {tavilyUsage.limit != null && (
                                  <span className="text-[var(--muted-foreground)]">
                                    {" "}/ {tavilyUsage.limit.toLocaleString()} credits
                                  </span>
                                )}
                              </span>
                              {tavilyUsage.limit != null && tavilyUsage.limit > 0 && (
                                <span className="text-xs text-[var(--muted-foreground)]">
                                  {Math.round((tavilyUsage.usage / tavilyUsage.limit) * 100)}%
                                </span>
                              )}
                            </div>

                            {tavilyUsage.limit != null && tavilyUsage.limit > 0 && (
                              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--border)]">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    tavilyUsage.usage / tavilyUsage.limit > 0.9
                                      ? "bg-[var(--danger)]"
                                      : tavilyUsage.usage / tavilyUsage.limit > 0.7
                                        ? "bg-[var(--warning)]"
                                        : "bg-[var(--accent)]"
                                  }`}
                                  style={{
                                    width: `${Math.min(100, (tavilyUsage.usage / tavilyUsage.limit) * 100)}%`,
                                  }}
                                />
                              </div>
                            )}

                            <div className="mt-2 flex gap-3 text-[11px] text-[var(--muted-foreground)]">
                              <span>Search: {tavilyUsage.searchUsage}</span>
                              <span>Extract: {tavilyUsage.extractUsage}</span>
                            </div>

                            <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                              额度按账单周期重置，具体时间请查看{" "}
                              <a
                                href="https://app.tavily.com/home"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline transition hover:text-[var(--accent)]"
                              >
                                Tavily Dashboard
                              </a>
                            </p>
                          </>
                        )}
                      </div>
                    )}

                    <div className="mt-5 border-t border-[var(--border)] pt-4">
                      <label className="block">
                        <span className={labelClass}>Exa API Key</span>
                        <SecretInput
                          value={settings.exaApiKey}
                          onChange={(e) =>
                            setSettings((current) => ({
                              ...current,
                              exaApiKey: e.target.value,
                            }))
                          }
                          placeholder="exa-..."
                        />
                      </label>
                      <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                        可选。作为 Tavily 的第二个联网来源参与负载均衡，用满一家时自动切到另一家。未填写时回退到环境变量 `EXA_API_KEY`。用量请查看{" "}
                        <a
                          href="https://dashboard.exa.ai"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline transition hover:text-[var(--accent)]"
                        >
                          Exa Dashboard
                        </a>
                        。
                      </p>

                      {/* Exa Usage Progress Bar (current calendar month) */}
                      {settings.exaApiKey && (
                        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--glass-bg)] p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
                              本月用量
                            </span>
                            {exaUsage && (
                              <span className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                                ${exaUsage.costUsd.toFixed(3)}
                              </span>
                            )}
                          </div>

                          {exaUsageLoading && (
                            <p className="mt-2 text-xs text-[var(--muted-foreground)]">查询中...</p>
                          )}

                          {exaUsageError && (
                            <p className="mt-2 text-xs text-[var(--danger)]">{exaUsageError}</p>
                          )}

                          {exaUsage && !exaUsageLoading && (
                            <>
                              <div className="mt-2 flex items-baseline justify-between">
                                <span className="text-sm font-medium text-[var(--foreground)]">
                                  {exaUsage.count.toLocaleString()}
                                  {exaUsage.limit != null && (
                                    <span className="text-[var(--muted-foreground)]">
                                      {" "}/ {exaUsage.limit.toLocaleString()} 次
                                    </span>
                                  )}
                                </span>
                                {exaUsage.limit != null && exaUsage.limit > 0 && (
                                  <span className="text-xs text-[var(--muted-foreground)]">
                                    {Math.round((exaUsage.count / exaUsage.limit) * 100)}%
                                  </span>
                                )}
                              </div>

                              {exaUsage.limit != null && exaUsage.limit > 0 && (
                                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--border)]">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      exaUsage.count / exaUsage.limit > 0.9
                                        ? "bg-[var(--danger)]"
                                        : exaUsage.count / exaUsage.limit > 0.7
                                          ? "bg-[var(--warning)]"
                                          : "bg-[var(--accent)]"
                                    }`}
                                    style={{
                                      width: `${Math.min(100, (exaUsage.count / exaUsage.limit) * 100)}%`,
                                    }}
                                  />
                                </div>
                              )}

                              <div className="mt-2 flex gap-3 text-[11px] text-[var(--muted-foreground)]">
                                <span>Search: {exaUsage.searchCount}</span>
                                <span>Contents: {exaUsage.contentsCount}</span>
                              </div>

                              <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
                                按自然月统计，免费额度上限 {exaUsage.limit?.toLocaleString()} 次。
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {builtInTools.map((tool) => (
                      <div
                        key={tool.name}
                        className="rounded-lg border border-[var(--border)] bg-[var(--glass-bg)] px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-mono text-[12px] text-[var(--accent)]">
                            {tool.name}
                          </p>
                          <span className="shrink-0 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)]">
                            调用 {toolUsageCounts[tool.name] ?? 0} 次
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-[var(--foreground)]">
                          {tool.description}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* MCP Servers */}
                  <div className="mt-8">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
                        MCP Servers
                      </p>
                      <span className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-[var(--border)] px-3 py-1 text-[11px] leading-none text-[var(--muted-foreground)]">
                        {settings.mcpServers.length} 个
                      </span>
                    </div>
                    <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">
                      通过 Streamable HTTP 接入远程 MCP Server，其工具会在对话中自动可用。启用的 Server 会在每次请求时连接；某个 Server 连接失败会被跳过，不影响其余对话。
                    </p>

                    {settings.mcpServers.length > 0 && (
                      <div className="space-y-2">
                        {settings.mcpServers.map((server) => {
                          const isExpanded = expandedMcpServerId === server.id;
                          const testState: McpTestState =
                            mcpTestStates[server.id] ?? { status: "idle" };
                          const oauthInfo: McpOAuthInfo =
                            mcpOAuthStatuses[server.id] ?? { status: "unauthorized", expiresAt: null };
                          const oauthBadge = mcpOAuthBadge[oauthInfo.status];
                          const isAuthorizing = mcpAuthorizingId === server.id;
                          return (
                            <div
                              key={server.id}
                              className={`rounded-lg border ${
                                server.isEnabled
                                  ? "border-[var(--border)] bg-[var(--glass-bg)]"
                                  : "border-[var(--border)] bg-[var(--glass-bg)] opacity-70"
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
                                    className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${
                                      isExpanded ? "rotate-90" : ""
                                    }`}
                                  >
                                    <polyline points="9 18 15 12 9 6" />
                                  </svg>
                                  <span className="shrink-0 truncate text-sm font-medium text-[var(--foreground)]">
                                    {server.name || "未命名 Server"}
                                  </span>
                                  {server.url && (
                                    <span className="min-w-0 truncate font-mono text-[11px] text-[var(--muted-foreground)]">
                                      {server.url}
                                    </span>
                                  )}
                                </button>
                                <label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                                  <input
                                    type="checkbox"
                                    checked={server.isEnabled}
                                    onChange={(e) =>
                                      updateMcpServer(server.id, {
                                        isEnabled: e.target.checked,
                                      })
                                    }
                                    className="accent-[var(--accent)]"
                                  />
                                  启用
                                </label>
                                <button
                                  type="button"
                                  onClick={() => removeMcpServer(server.id)}
                                  className="shrink-0 text-[11px] text-[var(--muted-foreground)] transition hover:text-[var(--danger)]"
                                >
                                  删除
                                </button>
                              </div>

                              {isExpanded && (
                                <div className="space-y-4 border-t border-[var(--border)] px-4 py-4">
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
                                    <span className={labelClass}>认证方式</span>
                                    <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5">
                                      {([
                                        ["header", "Header"],
                                        ["oauth", "OAuth"],
                                      ] as const).map(([value, label]) => (
                                        <button
                                          key={value}
                                          type="button"
                                          onClick={() =>
                                            updateMcpServer(server.id, { authType: value })
                                          }
                                          className={`rounded-md px-3 py-1.5 text-xs transition ${
                                            server.authType === value
                                              ? "bg-[var(--accent)] text-[var(--primary-foreground)]"
                                              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                                          }`}
                                        >
                                          {label}
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {server.authType === "header" ? (
                                    <div>
                                      <div className="mb-2 flex items-center justify-between">
                                        <span className={labelClass}>请求 Headers</span>
                                        <button
                                          type="button"
                                          onClick={() => addMcpHeader(server.id)}
                                          className="text-[11px] text-[var(--accent)] transition hover:text-[var(--accent-strong)]"
                                        >
                                          + 添加 Header
                                        </button>
                                      </div>

                                      {server.headers.length === 0 ? (
                                        <p className="text-xs text-[var(--muted-foreground)]">
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
                                                className="shrink-0 px-1 py-3 text-[11px] text-[var(--muted-foreground)] transition hover:text-[var(--danger)]"
                                              >
                                                移除
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="space-y-4">
                                      <label className="block">
                                        <span className={labelClass}>授权范围（可选）</span>
                                        <input
                                          type="text"
                                          value={server.oauthScopes}
                                          onChange={(e) =>
                                            updateMcpServer(server.id, {
                                              oauthScopes: e.target.value,
                                            })
                                          }
                                          placeholder="留空使用服务器默认，如 repo read:user"
                                          className={inputClass}
                                        />
                                      </label>

                                      <div>
                                        <span className={labelClass}>授权状态</span>
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="min-w-0">
                                            <span className={`text-sm ${oauthBadge.color}`}>
                                              {oauthBadge.dot} {oauthBadge.label}
                                            </span>
                                            {oauthInfo.status === "authorized" &&
                                              formatMcpTokenRemaining(oauthInfo.expiresAt) && (
                                                <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                                                  · {formatMcpTokenRemaining(oauthInfo.expiresAt)}
                                                </span>
                                              )}
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => authorizeMcpServer(server)}
                                            disabled={!server.url.trim() || isAuthorizing}
                                            className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--accent)] transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            {isAuthorizing
                                              ? "跳转中…"
                                              : oauthInfo.status === "unauthorized"
                                                ? "授权"
                                                : "重新授权"}
                                          </button>
                                        </div>
                                        <p className="mt-2 text-xs leading-5 text-[var(--muted-foreground)]">
                                          授权一次即可；聊天时自动使用、过期自动续期。点击授权会先保存设置并跳转到授权页面。
                                        </p>
                                      </div>
                                    </div>
                                  )}

                                  <div>
                                    <div className="mb-2 flex items-center justify-between">
                                      <span className={labelClass}>连接测试</span>
                                      <button
                                        type="button"
                                        onClick={() => testMcpServerConnection(server)}
                                        disabled={
                                          !server.url.trim() || testState.status === "loading"
                                        }
                                        className="text-[11px] text-[var(--accent)] transition hover:text-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {testState.status === "loading" ? "测试中…" : "测试连接"}
                                      </button>
                                    </div>

                                    {testState.status === "idle" && (
                                      <p className="text-xs text-[var(--muted-foreground)]">
                                        使用当前填写的 URL 与 Headers 连接一次，并列出该 Server 提供的工具。
                                      </p>
                                    )}
                                    {testState.status === "loading" && (
                                      <p className="text-xs text-[var(--muted-foreground)]">正在连接并发现工具…</p>
                                    )}
                                    {testState.status === "error" && (
                                      <p className="text-xs text-[var(--danger)]">{testState.error}</p>
                                    )}
                                    {testState.status === "success" &&
                                      (testState.tools.length === 0 ? (
                                        <p className="text-xs text-[var(--success)]">
                                          连接成功，但该 Server 未提供任何工具。
                                        </p>
                                      ) : (
                                        <div>
                                          <p className="mb-2 text-xs text-[var(--success)]">
                                            连接成功，发现 {testState.tools.length} 个工具。
                                          </p>
                                          <ul className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--glass-bg)] px-4 py-3">
                                            {testState.tools.map((tool) => (
                                              <li key={tool.name}>
                                                <p className="font-mono text-xs text-[var(--foreground)]">
                                                  {tool.name}
                                                </p>
                                                {tool.description && (
                                                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--muted-foreground)]">
                                                    {tool.description}
                                                  </p>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      ))}
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
                      className="mt-3 rounded-lg border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted-foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      + 添加 MCP Server
                    </button>
                  </div>

                  {/* Skills */}
                  <div className="mt-8">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">
                        Skills
                      </p>
                      <span className="inline-flex shrink-0 whitespace-nowrap rounded-full border border-[var(--border)] px-3 py-1 text-[11px] leading-none text-[var(--muted-foreground)]">
                        {skills.length} 个
                      </span>
                    </div>
                    <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">
                      Skills 是预先写好的可复用操作指南，放在服务器的 skill 目录（默认{" "}
                      <code>workspace/skills/</code>，可用环境变量 <code>SKILLS_DIR</code> 指定）
                      下，每个子目录一个 <code>SKILL.md</code>。检测到的 Skill 会按用途自动提供
                      给 AI，可在此逐个停用。在服务器增删或修改 Skill 文件后，刷新本页即可重新检测。
                    </p>

                    {skillsLoading ? (
                      <p className="text-xs text-[var(--muted-foreground)]">检测中…</p>
                    ) : skillsError ? (
                      <p className="text-xs text-[var(--danger)]">{skillsError}</p>
                    ) : skills.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-3 text-xs leading-5 text-[var(--muted-foreground)]">
                        未检测到 Skill。在服务器的 skill 目录下创建一个子目录并放入 SKILL.md
                        （开头用 frontmatter 标注 name 与 description），刷新本页后即可在此看到。
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {skills.map((skill) => {
                          const enabled = !settings.disabledSkills.includes(skill.name);
                          return (
                            <div
                              key={skill.name}
                              className={`rounded-lg border px-4 py-3 ${
                                enabled
                                  ? "border-[var(--border)] bg-[var(--glass-bg)]"
                                  : "border-[var(--border)] bg-[var(--glass-bg)] opacity-70"
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="font-mono text-[12px] text-[var(--accent)]">
                                    {skill.name}
                                  </p>
                                  <p className="mt-1 text-sm leading-6 text-[var(--foreground)]">
                                    {skill.description}
                                  </p>
                                </div>
                                <label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                                  <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={() => toggleSkillDisabled(skill.name)}
                                    className="accent-[var(--accent)]"
                                  />
                                  启用
                                </label>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex items-center justify-end gap-3 border-t border-[var(--border)] pt-5">
                    {saveMessage && (
                      <span
                        className={`text-xs ${
                          saveMessage.type === "success" ? "text-[var(--success)]" : "text-[var(--danger)]"
                        }`}
                      >
                        {saveMessage.text}
                      </span>
                    )}
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="rounded-full bg-foreground px-5 py-2 text-xs font-medium uppercase tracking-[0.14em] text-primary-foreground transition hover:bg-[var(--accent-strong)] disabled:opacity-50"
                    >
                      {isSaving ? "保存中..." : "保存"}
                    </button>
                  </div>
                </section>
              )}
            </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
