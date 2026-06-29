import { describe, it, expect } from "vitest";
import {
  normalizeMcpServer,
  normalizeProviderConfig,
  normalizeProviderSettings,
  normalizeSystemSettings,
  providerSettingsSchema,
  systemSettingsSchema,
  mcpServerSchema,
  defaultProviderConfig,
  defaultProviderSettings,
  type McpServer,
  type ProviderConfig,
  type ProviderSettings,
  type SystemSettings,
} from "@/lib/provider-config";

// ---------------------------------------------------------------------------
// Typed fixture builders. Each normalize function expects an already-parsed
// (schema-shaped) value, so we build fully-populated objects and override only
// the fields under test. This keeps the suite type-clean without `any`.
// ---------------------------------------------------------------------------

function makeMcpServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "srv-1",
    name: "My Server",
    url: "https://example.com/mcp",
    authType: "header",
    oauthScopes: "",
    headers: [],
    isEnabled: true,
    ...overrides,
  };
}

function makeProviderConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    providerName: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "",
    protocol: "chat-completion",
    tavilyApiKey: "",
    exaApiKey: "",
    ...overrides,
  };
}

function makeProviderSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    id: "prov-1",
    name: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    protocol: "chat-completion",
    isEnabled: true,
    isDefault: false,
    models: [],
    ...overrides,
  };
}

function makeSystemSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  return {
    tavilyApiKey: "",
    exaApiKey: "",
    providers: [],
    mcpServers: [],
    disabledSkills: [],
    preferences: { fontSans: "", fontMono: "" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeMcpServer
// ---------------------------------------------------------------------------

describe("normalizeMcpServer", () => {
  it("strips trailing slashes from the url", () => {
    const result = normalizeMcpServer(
      makeMcpServer({ url: "https://example.com/mcp///" }),
    );
    expect(result.url).toBe("https://example.com/mcp");
  });

  it("does not strip a non-trailing slash inside the url path", () => {
    const result = normalizeMcpServer(
      makeMcpServer({ url: "https://example.com/a/b/" }),
    );
    expect(result.url).toBe("https://example.com/a/b");
  });

  it("trims the url before stripping trailing slashes", () => {
    const result = normalizeMcpServer(
      makeMcpServer({ url: "  https://example.com/mcp/  " }),
    );
    expect(result.url).toBe("https://example.com/mcp");
  });

  it("trims the name", () => {
    const result = normalizeMcpServer(makeMcpServer({ name: "  Named  " }));
    expect(result.name).toBe("Named");
  });

  it("falls back to 'MCP Server' when name trims to empty", () => {
    const result = normalizeMcpServer(makeMcpServer({ name: "   " }));
    expect(result.name).toBe("MCP Server");
  });

  it("trims the id", () => {
    const result = normalizeMcpServer(makeMcpServer({ id: "  srv-9  " }));
    expect(result.id).toBe("srv-9");
  });

  it("trims header keys and values", () => {
    const result = normalizeMcpServer(
      makeMcpServer({
        headers: [{ key: "  Authorization  ", value: "  Bearer x  " }],
      }),
    );
    expect(result.headers).toEqual([
      { key: "Authorization", value: "Bearer x" },
    ]);
  });

  it("drops headers whose key trims to empty", () => {
    const result = normalizeMcpServer(
      makeMcpServer({
        headers: [
          { key: "  ", value: "orphan" },
          { key: "X-Real", value: "kept" },
        ],
      }),
    );
    expect(result.headers).toEqual([{ key: "X-Real", value: "kept" }]);
  });

  it("keeps a header with a non-empty key but empty value (value trimmed to '')", () => {
    const result = normalizeMcpServer(
      makeMcpServer({ headers: [{ key: "X-Empty", value: "   " }] }),
    );
    expect(result.headers).toEqual([{ key: "X-Empty", value: "" }]);
  });

  it("returns an empty header list when given no headers", () => {
    expect(normalizeMcpServer(makeMcpServer({ headers: [] })).headers).toEqual(
      [],
    );
  });

  it("strips trailing slashes even from a bare-origin url", () => {
    const result = normalizeMcpServer(
      makeMcpServer({ url: "https://example.com///" }),
    );
    expect(result.url).toBe("https://example.com");
  });

  it("passes isEnabled through unchanged", () => {
    expect(normalizeMcpServer(makeMcpServer({ isEnabled: false })).isEnabled).toBe(
      false,
    );
    expect(normalizeMcpServer(makeMcpServer({ isEnabled: true })).isEnabled).toBe(
      true,
    );
  });

  it("passes authType through unchanged", () => {
    expect(normalizeMcpServer(makeMcpServer({ authType: "oauth" })).authType).toBe(
      "oauth",
    );
    expect(normalizeMcpServer(makeMcpServer({ authType: "header" })).authType).toBe(
      "header",
    );
  });

  it("trims oauthScopes", () => {
    expect(
      normalizeMcpServer(makeMcpServer({ oauthScopes: "  repo read:user  " }))
        .oauthScopes,
    ).toBe("repo read:user");
  });
});

// ---------------------------------------------------------------------------
// normalizeProviderConfig
// ---------------------------------------------------------------------------

describe("normalizeProviderConfig", () => {
  it("trims providerName, apiKey, model, tavilyApiKey, exaApiKey", () => {
    const result = normalizeProviderConfig(
      makeProviderConfig({
        providerName: "  Acme  ",
        apiKey: "  sk-1  ",
        model: "  gpt-4  ",
        tavilyApiKey: "  tav  ",
        exaApiKey: "  exa  ",
      }),
    );
    expect(result.providerName).toBe("Acme");
    expect(result.apiKey).toBe("sk-1");
    expect(result.model).toBe("gpt-4");
    expect(result.tavilyApiKey).toBe("tav");
    expect(result.exaApiKey).toBe("exa");
  });

  it("falls back to the default providerName when it trims to empty", () => {
    const result = normalizeProviderConfig(
      makeProviderConfig({ providerName: "   " }),
    );
    expect(result.providerName).toBe(defaultProviderConfig.providerName);
  });

  it("falls back to the default baseUrl when baseUrl is empty", () => {
    const result = normalizeProviderConfig(makeProviderConfig({ baseUrl: "" }));
    expect(result.baseUrl).toBe(defaultProviderConfig.baseUrl);
  });

  it("strips trailing slashes from a provided baseUrl", () => {
    const result = normalizeProviderConfig(
      makeProviderConfig({ baseUrl: "https://api.acme.dev/v1//" }),
    );
    expect(result.baseUrl).toBe("https://api.acme.dev/v1");
  });

  it("trims a whitespace-padded baseUrl", () => {
    const result = normalizeProviderConfig(
      makeProviderConfig({ baseUrl: "  https://api.acme.dev/v1  " }),
    );
    expect(result.baseUrl).toBe("https://api.acme.dev/v1");
  });

  // KNOWN GAP: a whitespace-only baseUrl is truthy (non-empty string), so the
  // `|| default` fallback does NOT fire; after trimming it collapses to "".
  // This pins the current behavior.
  it("yields empty baseUrl for a whitespace-only baseUrl (current behavior)", () => {
    const result = normalizeProviderConfig(makeProviderConfig({ baseUrl: "   " }));
    expect(result.baseUrl).toBe("");
  });

  it("preserves an explicit non-default protocol", () => {
    const result = normalizeProviderConfig(
      makeProviderConfig({ protocol: "anthropic-message" }),
    );
    expect(result.protocol).toBe("anthropic-message");
  });

  it("preserves the openai-response protocol", () => {
    const result = normalizeProviderConfig(
      makeProviderConfig({ protocol: "openai-response" }),
    );
    expect(result.protocol).toBe("openai-response");
  });

  // The `protocol || "chat-completion"` guard is unreachable through the typed
  // (schema-parsed) ProviderProtocol, but it is a real runtime fallback. Force
  // a falsy protocol via a cast to pin that the empty branch resolves to the
  // default, instead of leaking an empty string.
  it("falls back to chat-completion for a falsy (empty) protocol", () => {
    const result = normalizeProviderConfig(
      makeProviderConfig({
        protocol: "" as unknown as ProviderConfig["protocol"],
      }),
    );
    expect(result.protocol).toBe("chat-completion");
  });

  it("returns a fully-normalized object for an already-clean config (no spurious mutation)", () => {
    const clean = makeProviderConfig({
      providerName: "Acme",
      baseUrl: "https://api.acme.dev/v1",
      apiKey: "sk-1",
      model: "gpt-4",
      protocol: "anthropic-message",
      tavilyApiKey: "tav",
      exaApiKey: "exa",
    });
    expect(normalizeProviderConfig(clean)).toEqual(clean);
  });
});

// ---------------------------------------------------------------------------
// normalizeProviderSettings
// ---------------------------------------------------------------------------

describe("normalizeProviderSettings", () => {
  it("drops models with empty id or empty modelId", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({
        models: [
          { id: "", modelId: "m1", isEnabled: true, isDefault: false },
          { id: "k2", modelId: "", isEnabled: true, isDefault: false },
          { id: "k3", modelId: "m3", isEnabled: true, isDefault: false },
        ],
      }),
    );
    expect(result.models.map((m) => m.id)).toEqual(["k3"]);
  });

  it("drops models whose id/modelId trim to empty", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({
        models: [
          { id: "   ", modelId: "m1", isEnabled: true, isDefault: false },
          { id: "k2", modelId: "  m2  ", isEnabled: true, isDefault: false },
        ],
      }),
    );
    // k2 is the lone surviving enabled model → it becomes the default.
    expect(result.models).toEqual([
      { id: "k2", modelId: "m2", isEnabled: true, isDefault: true },
    ]);
  });

  it("selects the enabled model flagged isDefault as the default", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({
        models: [
          { id: "a", modelId: "ma", isEnabled: true, isDefault: false },
          { id: "b", modelId: "mb", isEnabled: true, isDefault: true },
          { id: "c", modelId: "mc", isEnabled: true, isDefault: false },
        ],
      }),
    );
    const defaults = result.models.filter((m) => m.isDefault).map((m) => m.id);
    expect(defaults).toEqual(["b"]);
  });

  it("falls back to the first enabled model when none is flagged default", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({
        models: [
          { id: "a", modelId: "ma", isEnabled: false, isDefault: false },
          { id: "b", modelId: "mb", isEnabled: true, isDefault: false },
          { id: "c", modelId: "mc", isEnabled: true, isDefault: false },
        ],
      }),
    );
    const defaults = result.models.filter((m) => m.isDefault).map((m) => m.id);
    expect(defaults).toEqual(["b"]);
  });

  it("ignores isDefault on a disabled model (picks first enabled instead)", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({
        models: [
          { id: "a", modelId: "ma", isEnabled: false, isDefault: true },
          { id: "b", modelId: "mb", isEnabled: true, isDefault: false },
        ],
      }),
    );
    const defaults = result.models.filter((m) => m.isDefault).map((m) => m.id);
    expect(defaults).toEqual(["b"]);
  });

  it("marks no model as default when all are disabled", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({
        models: [
          { id: "a", modelId: "ma", isEnabled: false, isDefault: true },
          { id: "b", modelId: "mb", isEnabled: false, isDefault: false },
        ],
      }),
    );
    expect(result.models.some((m) => m.isDefault)).toBe(false);
  });

  it("clears a stale isDefault flag from a non-selected model", () => {
    // 'a' carries isDefault but 'b' is the flagged enabled default → 'a' reset.
    const result = normalizeProviderSettings(
      makeProviderSettings({
        models: [
          { id: "a", modelId: "ma", isEnabled: true, isDefault: true },
          { id: "b", modelId: "mb", isEnabled: true, isDefault: true },
        ],
      }),
    );
    // find(...isDefault) returns the FIRST flagged enabled model → 'a'.
    const defaults = result.models.filter((m) => m.isDefault).map((m) => m.id);
    expect(defaults).toEqual(["a"]);
  });

  it("trims id and apiKey", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({ id: "  p9  ", apiKey: "  key  " }),
    );
    expect(result.id).toBe("p9");
    expect(result.apiKey).toBe("key");
  });

  it("falls back to the default name when name trims to empty", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({ name: "   " }),
    );
    expect(result.name).toBe(defaultProviderSettings.name);
  });

  it("falls back to default baseUrl when empty and strips trailing slashes otherwise", () => {
    expect(
      normalizeProviderSettings(makeProviderSettings({ baseUrl: "" })).baseUrl,
    ).toBe(defaultProviderSettings.baseUrl);
    expect(
      normalizeProviderSettings(
        makeProviderSettings({ baseUrl: "https://x.dev/v1//" }),
      ).baseUrl,
    ).toBe("https://x.dev/v1");
  });

  it("preserves an explicit non-default protocol", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({ protocol: "openai-response" }),
    );
    expect(result.protocol).toBe("openai-response");
  });

  // Same defensive guard as normalizeProviderConfig: unreachable through the
  // typed value, but the runtime `protocol || "chat-completion"` must still
  // collapse a falsy protocol to the default.
  it("falls back to chat-completion for a falsy (empty) protocol", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({
        protocol: "" as unknown as ProviderSettings["protocol"],
      }),
    );
    expect(result.protocol).toBe("chat-completion");
  });

  it("returns an empty model list and no default when there are no models", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({ models: [] }),
    );
    expect(result.models).toEqual([]);
  });

  it("returns an empty model list and no default when every model is dropped", () => {
    // Both models have an empty id/modelId after trimming → all filtered out,
    // so there is no enabled model to promote to default.
    const result = normalizeProviderSettings(
      makeProviderSettings({
        models: [
          { id: "  ", modelId: "m1", isEnabled: true, isDefault: true },
          { id: "k2", modelId: "   ", isEnabled: true, isDefault: false },
        ],
      }),
    );
    expect(result.models).toEqual([]);
  });

  it("trims surviving model ids and modelIds", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({
        models: [
          { id: "  a  ", modelId: "  ma  ", isEnabled: true, isDefault: false },
        ],
      }),
    );
    expect(result.models).toEqual([
      { id: "a", modelId: "ma", isEnabled: true, isDefault: true },
    ]);
  });

  it("preserves disabled models in the output (only excludes them from default selection)", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({
        models: [
          { id: "a", modelId: "ma", isEnabled: false, isDefault: false },
          { id: "b", modelId: "mb", isEnabled: true, isDefault: false },
        ],
      }),
    );
    // both kept; default promoted to the first enabled one (b).
    expect(result.models).toEqual([
      { id: "a", modelId: "ma", isEnabled: false, isDefault: false },
      { id: "b", modelId: "mb", isEnabled: true, isDefault: true },
    ]);
  });

  it("passes isEnabled and isDefault through", () => {
    const result = normalizeProviderSettings(
      makeProviderSettings({ isEnabled: false, isDefault: true }),
    );
    expect(result.isEnabled).toBe(false);
    expect(result.isDefault).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeSystemSettings
// ---------------------------------------------------------------------------

describe("normalizeSystemSettings", () => {
  it("drops providers whose id trims to empty", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        providers: [
          makeProviderSettings({ id: "   " }),
          makeProviderSettings({ id: "keep" }),
        ],
      }),
    );
    expect(result.providers.map((p) => p.id)).toEqual(["keep"]);
  });

  it("trims tavilyApiKey and exaApiKey", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({ tavilyApiKey: "  t  ", exaApiKey: "  e  " }),
    );
    expect(result.tavilyApiKey).toBe("t");
    expect(result.exaApiKey).toBe("e");
  });

  it("default provider = enabled + isDefault", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        providers: [
          makeProviderSettings({ id: "a", isEnabled: true, isDefault: false }),
          makeProviderSettings({ id: "b", isEnabled: true, isDefault: true }),
          makeProviderSettings({ id: "c", isEnabled: true, isDefault: false }),
        ],
      }),
    );
    const defaults = result.providers.filter((p) => p.isDefault).map((p) => p.id);
    expect(defaults).toEqual(["b"]);
  });

  it("default provider falls back to first enabled when none flagged", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        providers: [
          makeProviderSettings({ id: "a", isEnabled: false, isDefault: false }),
          makeProviderSettings({ id: "b", isEnabled: true, isDefault: false }),
          makeProviderSettings({ id: "c", isEnabled: true, isDefault: false }),
        ],
      }),
    );
    const defaults = result.providers.filter((p) => p.isDefault).map((p) => p.id);
    expect(defaults).toEqual(["b"]);
  });

  it("default provider falls back to first provider when none enabled", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        providers: [
          makeProviderSettings({ id: "a", isEnabled: false, isDefault: false }),
          makeProviderSettings({ id: "b", isEnabled: false, isDefault: true }),
        ],
      }),
    );
    const defaults = result.providers.filter((p) => p.isDefault).map((p) => p.id);
    expect(defaults).toEqual(["a"]);
  });

  it("marks no provider default when the provider list is empty", () => {
    const result = normalizeSystemSettings(makeSystemSettings({ providers: [] }));
    expect(result.providers).toEqual([]);
  });

  it("reassigns isDefault across providers (clears stale flags)", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        providers: [
          makeProviderSettings({ id: "a", isEnabled: true, isDefault: true }),
          makeProviderSettings({ id: "b", isEnabled: true, isDefault: true }),
        ],
      }),
    );
    // enabled + first-flagged-isDefault wins → 'a'; 'b' is cleared.
    expect(result.providers.find((p) => p.id === "a")?.isDefault).toBe(true);
    expect(result.providers.find((p) => p.id === "b")?.isDefault).toBe(false);
  });

  it("drops mcpServers when id is empty", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        mcpServers: [
          makeMcpServer({ id: "  ", url: "https://a.dev/mcp" }),
          makeMcpServer({ id: "keep", url: "https://b.dev/mcp" }),
        ],
      }),
    );
    expect(result.mcpServers.map((s) => s.id)).toEqual(["keep"]);
  });

  it("drops mcpServers when url trims to empty", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        mcpServers: [
          makeMcpServer({ id: "x", url: "   " }),
          makeMcpServer({ id: "keep", url: "https://b.dev/mcp" }),
        ],
      }),
    );
    expect(result.mcpServers.map((s) => s.id)).toEqual(["keep"]);
  });

  it("normalizes surviving mcpServers (trailing slash stripped)", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        mcpServers: [makeMcpServer({ id: "x", url: "https://b.dev/mcp//" })],
      }),
    );
    expect(result.mcpServers[0].url).toBe("https://b.dev/mcp");
  });

  it("trims, de-duplicates, and removes empties from disabledSkills", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        disabledSkills: ["  a  ", "a", "", "  ", "b", "b ", "c"],
      }),
    );
    expect(result.disabledSkills).toEqual(["a", "b", "c"]);
  });

  it("preserves first-seen order while de-duplicating disabledSkills", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({ disabledSkills: ["z", "a", "z", "m", "a"] }),
    );
    expect(result.disabledSkills).toEqual(["z", "a", "m"]);
  });

  it("returns empty collections for an empty (default-shaped) input", () => {
    const result = normalizeSystemSettings(makeSystemSettings());
    expect(result).toEqual({
      tavilyApiKey: "",
      exaApiKey: "",
      providers: [],
      mcpServers: [],
      disabledSkills: [],
      preferences: { fontSans: "", fontMono: "" },
    });
  });

  it("recursively normalizes each provider's models (default reassigned)", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        providers: [
          makeProviderSettings({
            id: "p",
            models: [
              { id: "m1", modelId: "a", isEnabled: true, isDefault: false },
              { id: "m2", modelId: "b", isEnabled: true, isDefault: false },
            ],
          }),
        ],
      }),
    );
    // first enabled model becomes the default after nested normalization.
    expect(result.providers[0].models).toEqual([
      { id: "m1", modelId: "a", isEnabled: true, isDefault: true },
      { id: "m2", modelId: "b", isEnabled: true, isDefault: false },
    ]);
  });

  it("retains the lone provider as default even when it is disabled and not flagged", () => {
    // No enabled provider exists, so the default falls through to the first
    // provider in the list regardless of its flags.
    const result = normalizeSystemSettings(
      makeSystemSettings({
        providers: [
          makeProviderSettings({ id: "only", isEnabled: false, isDefault: false }),
        ],
      }),
    );
    expect(result.providers[0].isDefault).toBe(true);
  });

  it("normalizes every field together end-to-end", () => {
    const result = normalizeSystemSettings(
      makeSystemSettings({
        tavilyApiKey: "  tav  ",
        exaApiKey: "  exa  ",
        providers: [
          makeProviderSettings({ id: "   " }), // dropped
          makeProviderSettings({
            id: "  keep  ",
            isEnabled: true,
            isDefault: true,
          }),
        ],
        mcpServers: [
          makeMcpServer({ id: "  ", url: "https://drop.dev" }), // dropped (empty id)
          makeMcpServer({ id: "ok", url: "https://ok.dev/mcp//" }),
        ],
        disabledSkills: ["  s1  ", "s1", ""],
      }),
    );
    expect(result.tavilyApiKey).toBe("tav");
    expect(result.exaApiKey).toBe("exa");
    expect(result.providers.map((p) => p.id)).toEqual(["keep"]);
    expect(result.providers[0].isDefault).toBe(true);
    expect(result.mcpServers).toEqual([
      {
        id: "ok",
        name: "My Server",
        url: "https://ok.dev/mcp",
        authType: "header",
        oauthScopes: "",
        headers: [],
        isEnabled: true,
      },
    ]);
    expect(result.disabledSkills).toEqual(["s1"]);
  });
});

// ---------------------------------------------------------------------------
// Schema parsing / defaults
// ---------------------------------------------------------------------------

describe("mcpServerSchema", () => {
  it("applies defaults: name, headers, isEnabled", () => {
    const parsed = mcpServerSchema.parse({
      id: "s1",
      url: "https://example.com",
    });
    expect(parsed.name).toBe("MCP Server");
    expect(parsed.headers).toEqual([]);
    expect(parsed.isEnabled).toBe(true);
  });

  it("trims id and url", () => {
    const parsed = mcpServerSchema.parse({
      id: "  s1  ",
      url: "  https://example.com  ",
    });
    expect(parsed.id).toBe("s1");
    expect(parsed.url).toBe("https://example.com");
  });

  it("rejects a non-URL value", () => {
    expect(() =>
      mcpServerSchema.parse({ id: "s1", url: "not a url" }),
    ).toThrow();
  });

  it("rejects an empty id", () => {
    expect(() =>
      mcpServerSchema.parse({ id: "", url: "https://example.com" }),
    ).toThrow();
  });

  it("applies the header value default when only key is given", () => {
    const parsed = mcpServerSchema.parse({
      id: "s1",
      url: "https://example.com",
      headers: [{ key: "X" }],
    });
    expect(parsed.headers[0]).toEqual({ key: "X", value: "" });
  });

  // Schema-level rejection of empty-key headers. Note this differs from
  // normalizeMcpServer, which silently DROPS empty-key headers instead.
  it("rejects a header whose key trims to empty", () => {
    expect(() =>
      mcpServerSchema.parse({
        id: "s1",
        url: "https://example.com",
        headers: [{ key: "  " }],
      }),
    ).toThrow();
  });

  it("rejects a header value longer than 2000 characters", () => {
    expect(() =>
      mcpServerSchema.parse({
        id: "s1",
        url: "https://example.com",
        headers: [{ key: "K", value: "a".repeat(2001) }],
      }),
    ).toThrow();
  });

  // The .default("MCP Server") only fills a MISSING name; an explicitly
  // provided blank name still fails the min(1) check on the trimmed value.
  it("rejects an explicitly provided blank name", () => {
    expect(() =>
      mcpServerSchema.parse({ id: "s1", url: "https://example.com", name: "  " }),
    ).toThrow();
  });

  it("rejects a url without a protocol scheme", () => {
    expect(() =>
      mcpServerSchema.parse({ id: "s1", url: "example.com" }),
    ).toThrow();
  });
});

describe("providerSettingsSchema", () => {
  it("applies defaults for name, baseUrl, apiKey, protocol, flags, models", () => {
    const parsed = providerSettingsSchema.parse({ id: "p1" });
    expect(parsed.name).toBe("OpenAI Compatible");
    expect(parsed.baseUrl).toBe("https://api.openai.com/v1");
    expect(parsed.apiKey).toBe("");
    expect(parsed.protocol).toBe("chat-completion");
    expect(parsed.isEnabled).toBe(true);
    expect(parsed.isDefault).toBe(false);
    expect(parsed.models).toEqual([]);
  });

  it("applies model defaults isEnabled=true and isDefault=false", () => {
    const parsed = providerSettingsSchema.parse({
      id: "p1",
      models: [{ id: "m1", modelId: "gpt-4" }],
    });
    expect(parsed.models[0]).toEqual({
      id: "m1",
      modelId: "gpt-4",
      isEnabled: true,
      isDefault: false,
    });
  });

  it("rejects an empty provider id", () => {
    expect(() => providerSettingsSchema.parse({ id: "" })).toThrow();
  });

  it("rejects a model with an empty modelId", () => {
    expect(() =>
      providerSettingsSchema.parse({
        id: "p1",
        models: [{ id: "m1", modelId: "" }],
      }),
    ).toThrow();
  });

  it("rejects an invalid protocol", () => {
    expect(() =>
      providerSettingsSchema.parse({ id: "p1", protocol: "bogus" }),
    ).toThrow();
  });

  it("rejects a model with an empty id", () => {
    expect(() =>
      providerSettingsSchema.parse({
        id: "p1",
        models: [{ id: "", modelId: "gpt-4" }],
      }),
    ).toThrow();
  });

  it("trims id, name, baseUrl, and apiKey during parsing", () => {
    const parsed = providerSettingsSchema.parse({
      id: "  p1  ",
      name: "  Acme  ",
      baseUrl: "  https://api.acme.dev/v1  ",
      apiKey: "  sk-1  ",
    });
    expect(parsed.id).toBe("p1");
    expect(parsed.name).toBe("Acme");
    expect(parsed.baseUrl).toBe("https://api.acme.dev/v1");
    expect(parsed.apiKey).toBe("sk-1");
  });
});

describe("systemSettingsSchema", () => {
  it("applies top-level defaults", () => {
    const parsed = systemSettingsSchema.parse({});
    expect(parsed.tavilyApiKey).toBe("");
    expect(parsed.exaApiKey).toBe("");
    expect(parsed.providers).toEqual([]);
    expect(parsed.mcpServers).toEqual([]);
    expect(parsed.disabledSkills).toEqual([]);
  });

  it("rejects a disabledSkills entry that trims to empty", () => {
    expect(() =>
      systemSettingsSchema.parse({ disabledSkills: ["ok", "   "] }),
    ).toThrow();
  });

  it("parses nested providers and mcpServers with their defaults", () => {
    const parsed = systemSettingsSchema.parse({
      providers: [{ id: "p1" }],
      mcpServers: [{ id: "s1", url: "https://example.com" }],
    });
    expect(parsed.providers[0].name).toBe("OpenAI Compatible");
    expect(parsed.providers[0].isEnabled).toBe(true);
    expect(parsed.mcpServers[0].name).toBe("MCP Server");
    expect(parsed.mcpServers[0].isEnabled).toBe(true);
  });

  it("rejects a nested mcpServer with a non-URL value", () => {
    expect(() =>
      systemSettingsSchema.parse({
        mcpServers: [{ id: "s1", url: "not-a-url" }],
      }),
    ).toThrow();
  });

  it("rejects a nested provider with an empty id", () => {
    expect(() =>
      systemSettingsSchema.parse({ providers: [{ id: "" }] }),
    ).toThrow();
  });

  it("trims disabledSkills entries during parsing", () => {
    const parsed = systemSettingsSchema.parse({
      disabledSkills: ["  skill-a  "],
    });
    expect(parsed.disabledSkills).toEqual(["skill-a"]);
  });

  it("trims top-level api keys during parsing", () => {
    const parsed = systemSettingsSchema.parse({
      tavilyApiKey: "  tav  ",
      exaApiKey: "  exa  ",
    });
    expect(parsed.tavilyApiKey).toBe("tav");
    expect(parsed.exaApiKey).toBe("exa");
  });
});
