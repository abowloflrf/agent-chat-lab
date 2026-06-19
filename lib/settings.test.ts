import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ProviderSettings, SystemSettings } from "@/lib/provider-config";

// settings.ts captures `envProviderConfig` from process.env at import time, and the
// pure resolvers fall back to it. Pin sentinel env values BEFORE importing so the
// fallback path is deterministic regardless of the ambient environment.
const ENV = {
  OPENAI_BASE_URL: "https://env.example/v1",
  OPENAI_API_KEY: "env-key",
  OPENAI_MODEL: "env-model",
  TAVILY_API_KEY: "env-tavily",
  EXA_API_KEY: "env-exa",
};

let settings: typeof import("@/lib/settings");

beforeAll(async () => {
  for (const [key, value] of Object.entries(ENV)) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  settings = await import("@/lib/settings");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function makeModel(over: Partial<ProviderSettings["models"][number]> = {}) {
  return {
    id: "m1",
    modelId: "gpt-x",
    isEnabled: true,
    isDefault: true,
    ...over,
  } satisfies ProviderSettings["models"][number];
}

function makeProvider(over: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    id: "p1",
    name: "P1",
    baseUrl: "https://p.example/v1",
    apiKey: "pk",
    protocol: "chat-completion",
    isEnabled: true,
    isDefault: true,
    models: [makeModel()],
    ...over,
  };
}

function makeSettings(over: Partial<SystemSettings> = {}): SystemSettings {
  return {
    tavilyApiKey: "",
    exaApiKey: "",
    providers: [],
    mcpServers: [],
    disabledSkills: [],
    ...over,
  };
}

describe("getRuntimeProviderConfigFromSettings", () => {
  it("builds the config from the active provider + model (baseUrl trailing slash stripped)", () => {
    const result = settings.getRuntimeProviderConfigFromSettings(
      makeSettings({
        tavilyApiKey: "st",
        providers: [makeProvider({ baseUrl: "https://p.example/v1/" })],
      }),
    );

    expect(result.baseUrl).toBe("https://p.example/v1");
    expect(result.apiKey).toBe("pk");
    expect(result.model).toBe("gpt-x");
    expect(result.protocol).toBe("chat-completion");
    // settings key wins; the unset exa key falls back to the env sentinel.
    expect(result.tavilyApiKey).toBe("st");
    expect(result.exaApiKey).toBe("env-exa");
  });

  it("prefers the enabled+default provider over the first enabled one", () => {
    const result = settings.getRuntimeProviderConfigFromSettings(
      makeSettings({
        providers: [
          makeProvider({ id: "a", isDefault: false, apiKey: "first" }),
          makeProvider({ id: "b", isDefault: true, apiKey: "default" }),
        ],
      }),
    );
    expect(result.apiKey).toBe("default");
  });

  it("prefers the enabled+default model over the first enabled model", () => {
    const result = settings.getRuntimeProviderConfigFromSettings(
      makeSettings({
        providers: [
          makeProvider({
            models: [
              makeModel({ id: "x", modelId: "first", isDefault: false }),
              makeModel({ id: "y", modelId: "chosen", isDefault: true }),
            ],
          }),
        ],
      }),
    );
    expect(result.model).toBe("chosen");
  });

  it("falls back to the env config when there is no provider", () => {
    const result = settings.getRuntimeProviderConfigFromSettings(makeSettings());
    expect(result).toMatchObject({
      baseUrl: "https://env.example/v1",
      apiKey: "env-key",
      model: "env-model",
      tavilyApiKey: "env-tavily",
      exaApiKey: "env-exa",
    });
  });

  it("falls back to the env config when the provider has no model", () => {
    const result = settings.getRuntimeProviderConfigFromSettings(
      makeSettings({ providers: [makeProvider({ models: [] })] }),
    );
    expect(result.model).toBe("env-model");
    expect(result.apiKey).toBe("env-key");
  });
});

describe("getProviderConfigByOverrideFromSettings", () => {
  it("uses the requested enabled provider + model", () => {
    const result = settings.getProviderConfigByOverrideFromSettings(
      makeSettings({
        providers: [
          makeProvider({ id: "a", apiKey: "ka", models: [makeModel({ modelId: "ma" })] }),
          makeProvider({ id: "b", apiKey: "kb", models: [makeModel({ modelId: "mb" })] }),
        ],
      }),
      "b",
      "mb",
    );
    expect(result.apiKey).toBe("kb");
    expect(result.model).toBe("mb");
  });

  it("falls back to the runtime config when the provider id is unknown", () => {
    const result = settings.getProviderConfigByOverrideFromSettings(
      makeSettings({ providers: [makeProvider({ id: "a", apiKey: "ka" })] }),
      "does-not-exist",
      "gpt-x",
    );
    expect(result.apiKey).toBe("ka");
  });

  it("falls back when the requested provider is disabled", () => {
    const result = settings.getProviderConfigByOverrideFromSettings(
      makeSettings({
        providers: [
          makeProvider({ id: "a", isDefault: true, apiKey: "ka" }),
          makeProvider({ id: "b", isEnabled: false, apiKey: "kb" }),
        ],
      }),
      "b",
      "gpt-x",
    );
    expect(result.apiKey).toBe("ka");
  });

  it("falls back when the requested model is not enabled on the provider", () => {
    const result = settings.getProviderConfigByOverrideFromSettings(
      makeSettings({
        providers: [
          makeProvider({
            id: "a",
            apiKey: "ka",
            models: [makeModel({ modelId: "only", isEnabled: true })],
          }),
        ],
      }),
      "a",
      "missing-model",
    );
    expect(result.model).toBe("only");
  });
});

describe("getEnabledMcpServersFromSettings", () => {
  it("returns only enabled servers that have a url", () => {
    const result = settings.getEnabledMcpServersFromSettings(
      makeSettings({
        mcpServers: [
          { id: "1", name: "ok", url: "https://a.example", headers: [], isEnabled: true },
          { id: "2", name: "disabled", url: "https://b.example", headers: [], isEnabled: false },
          { id: "3", name: "no-url", url: "", headers: [], isEnabled: true },
        ],
      }),
    );
    expect(result.map((server) => server.id)).toEqual(["1"]);
  });

  it("returns an empty array when there are no servers", () => {
    expect(settings.getEnabledMcpServersFromSettings(makeSettings())).toEqual([]);
  });
});

describe("resolveProviderConfig", () => {
  it("merges valid input over the env fallback", () => {
    const result = settings.resolveProviderConfig({ model: "override-model" });
    expect(result.model).toBe("override-model");
    // unspecified fields fall back to env sentinels
    expect(result.baseUrl).toBe("https://env.example/v1");
    expect(result.apiKey).toBe("env-key");
  });

  it("strips a trailing slash from a provided baseUrl", () => {
    const result = settings.resolveProviderConfig({ baseUrl: "https://custom.example/v1/" });
    expect(result.baseUrl).toBe("https://custom.example/v1");
  });

  it("returns the env config when the input fails validation", () => {
    // baseUrl must be a string; a number fails the input schema.
    const result = settings.resolveProviderConfig({ baseUrl: 123 });
    expect(result).toMatchObject({
      baseUrl: "https://env.example/v1",
      apiKey: "env-key",
      model: "env-model",
    });
  });
});
