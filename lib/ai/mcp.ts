import "server-only";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { logger } from "@/lib/logger";
import type { McpServer } from "@/lib/provider-config";
import { McpOAuthProvider } from "@/lib/ai/mcp-oauth";
import { readSession } from "@/lib/db/mcp-oauth";

// Each MCP handshake + tool discovery has to finish within this budget. The chat
// route runs under a ceiling, so a single slow/unreachable server must not stall
// the whole request.
const MCP_CONNECT_TIMEOUT_MS = 8000;

// A single MCP tool *call* must also be bounded: without this, a hung remote tool
// would stall the agent loop until the route's hard ceiling. On timeout the agent
// gets an error and can recover instead of the whole turn hanging.
const MCP_TOOL_TIMEOUT_MS = 60000;

// How long a connected client may be reused across requests before it is dropped
// and re-established. Reuse removes the per-message handshake+discovery latency
// for active conversations; the cap bounds staleness and resource lifetime.
// Connections are also dropped eagerly on config/auth changes (see invalidateMcpCache).
const MCP_CACHE_TTL_MS = 5 * 60 * 1000;

export type McpServerToolInfo = {
  serverName: string;
  toolNames: string[];
};

export type McpToolDescriptor = {
  name: string;
  description: string;
};

export type McpToolBundle = {
  tools: ToolSet;
  /** Successfully connected servers and the tools each contributed. */
  servers: McpServerToolInfo[];
  close: () => Promise<void>;
};

type McpTransportInput = Pick<
  McpServer,
  "id" | "url" | "headers" | "authType" | "oauthScopes"
>;

type CacheEntry = {
  // Connection-relevant config snapshot; a change forces a reconnect.
  configKey: string;
  client: MCPClient;
  // Tools already wrapped with the per-call execution timeout.
  tools: ToolSet;
  serverName: string;
  createdAt: number;
  lastUsedAt: number;
};

// Reused MCP connections, keyed by server id. This module is loaded once in the
// long-lived server process, so the cache persists across chat requests.
const clientCache = new Map<string, CacheEntry>();
// In-flight connects, keyed by server id, so concurrent requests for the same
// uncached server share one handshake instead of racing to open duplicates.
const inflight = new Map<string, Promise<CacheEntry | null>>();

function headersToRecord(server: Pick<McpServer, "headers">): Record<string, string> | undefined {
  const entries = server.headers.filter((header) => header.key);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries.map((header) => [header.key, header.value]));
}

/**
 * Build the @ai-sdk/mcp transport config for a server. OAuth servers get an
 * `authProvider` that silently attaches the stored token (and refreshes it on a
 * 401). Header servers keep the plain static-header transport.
 */
function buildTransport(server: McpTransportInput, baseUrl: string) {
  const headers = headersToRecord(server);

  if (server.authType === "oauth") {
    return {
      type: "http" as const,
      url: server.url,
      headers,
      authProvider: new McpOAuthProvider(server.id, server.url, baseUrl, server.oauthScopes),
    };
  }

  return { type: "http" as const, url: server.url, headers };
}

// Make a string safe as a model-facing tool name segment. Mirrors what tool
// APIs accept (^[a-zA-Z0-9_-]+$).
function sanitizeToolSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Tools are namespaced as `<serverPrefix>_<toolName>` so two servers exposing the
// same tool name don't shadow each other. Server names aren't unique, so derive a
// unique prefix per server (deduped with a numeric suffix); fall back to "mcp"
// when a name has no usable ASCII (e.g. a CJK-only name).
function computeServerPrefixes(servers: McpServer[]): Map<string, string> {
  const prefixes = new Map<string, string>();
  const used = new Set<string>();

  for (const server of servers) {
    const sanitized = sanitizeToolSegment(server.name);
    const base = /[a-zA-Z0-9]/.test(sanitized) ? sanitized : "mcp";
    let prefix = base;
    let n = 2;
    while (used.has(prefix)) {
      prefix = `${base}_${n}`;
      n += 1;
    }
    used.add(prefix);
    prefixes.set(server.id, prefix);
  }

  return prefixes;
}

// Snapshot of the fields that affect the connection. The OAuth token is
// intentionally excluded: it is refreshed in place on the live client, and an
// explicit re-authorization invalidates the cache separately.
function makeConfigKey(server: McpTransportInput): string {
  return JSON.stringify({
    url: server.url,
    authType: server.authType,
    scopes: server.oauthScopes,
    headers: server.headers.filter((header) => header.key).map((header) => [header.key, header.value]),
  });
}

/**
 * True only when an OAuth server has a usable, authorized token in the DB *for
 * the current URL*. The serverUrl check guards against a token issued for a
 * previous URL being attached after the server was re-pointed (the token was
 * minted for a different authorization server / origin).
 */
function isOAuthAuthorized(server: Pick<McpServer, "id" | "url">): boolean {
  const session = readSession(server.id);
  return Boolean(
    session &&
      session.status === "authorized" &&
      session.tokensJson &&
      session.serverUrl === server.url,
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onLateSuccess?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      // The losing operation keeps running after the race; a late success
      // must still be cleaned up by the caller or its connection leaks.
      promise.then(onLateSuccess, () => {});
      reject(new Error(`${label}超时（${ms}ms）`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function closeClient(client: MCPClient | undefined): void {
  void client?.close().catch(() => {});
}

type ExecutableTool = { execute?: (...args: unknown[]) => unknown };

// Wrap each tool's execute with a timeout so one hung remote tool can't stall the
// agent loop. The wrapper is stateless, so the wrapped ToolSet is safe to cache
// and share across requests.
function wrapToolsWithTimeout(tools: ToolSet, serverName: string): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    const execute = (tool as ExecutableTool).execute;
    if (typeof execute !== "function") {
      wrapped[name] = tool;
      continue;
    }

    const boundExecute = execute.bind(tool);
    wrapped[name] = {
      ...tool,
      execute: (...callArgs: unknown[]) =>
        withTimeout(
          Promise.resolve(boundExecute(...callArgs)),
          MCP_TOOL_TIMEOUT_MS,
          `${serverName} 工具「${name}」执行`,
        ).catch((error) => {
          // Surface MCP tool failures/timeouts, which would otherwise only reach
          // the model as an error and stay invisible server-side.
          logger.warn(
            {
              mcpServer: serverName,
              tool: name,
              error: error instanceof Error ? error.message : String(error),
            },
            "MCP tool execution failed",
          );
          throw error;
        }),
    } as ToolSet[string];
  }

  return wrapped;
}

// Drop connections past their max age (also reclaims clients for servers the user
// removed). Called at the start of each connect pass.
function sweepExpired(now: number): void {
  for (const [serverId, entry] of clientCache) {
    if (now - entry.createdAt >= MCP_CACHE_TTL_MS) {
      clientCache.delete(serverId);
      closeClient(entry.client);
    }
  }
}

/** Drop a cached connection (one server, or all). Call when config/auth changes. */
export function invalidateMcpCache(serverId?: string): void {
  if (serverId) {
    const entry = clientCache.get(serverId);
    if (entry) {
      clientCache.delete(serverId);
      closeClient(entry.client);
    }
    return;
  }

  for (const entry of clientCache.values()) {
    closeClient(entry.client);
  }
  clientCache.clear();
}

// Open a fresh connection, list + wrap its tools, and cache it. Returns null on
// failure (logged, not thrown) so one bad server never blocks the conversation.
async function connectAndCache(
  server: McpServer,
  baseUrl: string,
  configKey: string,
): Promise<CacheEntry | null> {
  let client: MCPClient | undefined;
  const startedAt = Date.now();

  try {
    client = await withTimeout(
      createMCPClient({ transport: buildTransport(server, baseUrl) }),
      MCP_CONNECT_TIMEOUT_MS,
      `${server.name} 连接`,
      (lateClient) => closeClient(lateClient),
    );

    const rawTools = await withTimeout(
      client.tools(),
      MCP_CONNECT_TIMEOUT_MS,
      `${server.name} 工具发现`,
    );

    const now = Date.now();
    const entry: CacheEntry = {
      configKey,
      client,
      tools: wrapToolsWithTimeout(rawTools, server.name),
      serverName: server.name,
      createdAt: now,
      lastUsedAt: now,
    };
    clientCache.set(server.id, entry);
    logger.info(
      {
        mcpServer: server.name,
        url: server.url,
        toolCount: Object.keys(rawTools).length,
        durationMs: now - startedAt,
      },
      "MCP server connected",
    );
    return entry;
  } catch (error) {
    closeClient(client);
    logger.warn(
      {
        mcpServer: server.name,
        url: server.url,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to connect MCP server; skipping",
    );
    return null;
  }
}

// Return a live cached connection or establish one (single-flight per server id).
function getOrConnect(server: McpServer, baseUrl: string): Promise<CacheEntry | null> {
  const now = Date.now();
  const configKey = makeConfigKey(server);
  const cached = clientCache.get(server.id);

  if (cached && cached.configKey === configKey && now - cached.createdAt < MCP_CACHE_TTL_MS) {
    cached.lastUsedAt = now;
    return Promise.resolve(cached);
  }

  // Stale (config changed) or aged-out: drop it before reconnecting.
  if (cached) {
    clientCache.delete(server.id);
    closeClient(cached.client);
  }

  let pending = inflight.get(server.id);
  if (!pending) {
    pending = connectAndCache(server, baseUrl, configKey);
    inflight.set(server.id, pending);
    void pending.finally(() => {
      if (inflight.get(server.id) === pending) {
        inflight.delete(server.id);
      }
    });
  }
  return pending;
}

/**
 * Connect to a single MCP server, list its tools, and disconnect.
 *
 * Bypasses the connection cache: the settings UI must validate the live config
 * and surface the exact failure, so failures are thrown (not swallowed) and the
 * fresh client is always closed.
 */
export async function testMcpServer(
  server: Pick<McpServer, "id" | "name" | "url" | "headers" | "authType" | "oauthScopes">,
  baseUrl: string,
): Promise<McpToolDescriptor[]> {
  // OAuth servers can only be tested once authorized — the test reuses the
  // stored token rather than the draft form values.
  if (server.authType === "oauth" && !isOAuthAuthorized(server)) {
    throw new Error("该 MCP Server 使用 OAuth，请先在设置中完成授权后再测试连接。");
  }

  let client: MCPClient | undefined;

  try {
    client = await withTimeout(
      createMCPClient({
        transport: buildTransport(server, baseUrl),
      }),
      MCP_CONNECT_TIMEOUT_MS,
      `${server.name} 连接`,
      (lateClient) => closeClient(lateClient),
    );

    const tools = await withTimeout(client.tools(), MCP_CONNECT_TIMEOUT_MS, `${server.name} 工具发现`);

    return Object.entries(tools).map(([name, tool]) => ({
      name,
      // v7 allows dynamic (function) tool descriptions; only surface static strings here.
      description: typeof tool.description === "string" ? tool.description : "",
    }));
  } finally {
    closeClient(client);
  }
}

/**
 * Connect to every enabled MCP server over Streamable HTTP and merge their tools
 * into a single tool set, reusing cached connections where possible.
 *
 * A server that fails to connect or list tools is skipped (logged, not thrown)
 * so it never blocks the conversation. Tools from later servers override earlier
 * ones with the same name. Connections are owned by the module-level cache, so
 * `close()` is a no-op — call `invalidateMcpCache` when config/auth changes.
 */
export async function connectMcpServers(
  servers: McpServer[],
  baseUrl: string,
): Promise<McpToolBundle> {
  sweepExpired(Date.now());

  // Per-server prefix so cross-server same-name tools don't collide.
  const prefixes = computeServerPrefixes(servers);

  const tools: ToolSet = {};
  // Maps each namespaced tool name to its owning server, for prompt advertising.
  const toolOwner = new Map<string, string>();

  await Promise.all(
    servers.map(async (server) => {
      // Skip OAuth servers that aren't authorized before paying any connect cost:
      // an unauthorized one would otherwise trigger a slow 401→discovery roundtrip
      // (and a pointless server-side authorize redirect) that can blow the budget.
      // Also drop any connection cached from before the authorization lapsed.
      if (server.authType === "oauth" && !isOAuthAuthorized(server)) {
        invalidateMcpCache(server.id);
        logger.warn(
          { mcpServer: server.name, url: server.url },
          "Skipping MCP server: OAuth not authorized",
        );
        return;
      }

      const entry = await getOrConnect(server, baseUrl);
      if (!entry) {
        return;
      }

      // Namespace each tool as `<serverPrefix>_<toolName>`. The tool's execute
      // still calls the server with the original name (it's closed over by the
      // SDK), so the prefix only changes what the model sees.
      const prefix = prefixes.get(server.id) ?? sanitizeToolSegment(server.name);
      for (const [rawName, tool] of Object.entries(entry.tools)) {
        const name = `${prefix}_${sanitizeToolSegment(rawName)}`;
        tools[name] = tool;
        toolOwner.set(name, entry.serverName);
      }
    }),
  );

  // Group namespaced tools by their owning server so `servers` advertises the
  // exact callable names to the model.
  const toolsByServer = new Map<string, string[]>();
  for (const [toolName, serverName] of toolOwner) {
    const owned = toolsByServer.get(serverName) ?? [];
    owned.push(toolName);
    toolsByServer.set(serverName, owned);
  }
  const connectedServers: McpServerToolInfo[] = [...toolsByServer].map(
    ([serverName, toolNames]) => ({ serverName, toolNames }),
  );

  return {
    tools,
    servers: connectedServers,
    // Connections live in the module cache and are reused across requests; the
    // cache owns their lifecycle, so there is nothing to close per request.
    close: async () => {},
  };
}
