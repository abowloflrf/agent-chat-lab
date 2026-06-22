import "server-only";

import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type {
  OAuthClientProvider,
  OAuthClientMetadata,
  OAuthClientInformation,
  OAuthTokens,
} from "@ai-sdk/mcp";
import { patchSession, readSession } from "@/lib/db/mcp-oauth";
import { isPrivateIp } from "@/lib/ai/private-ip";

/**
 * Resolve the externally reachable base URL (scheme + host, no trailing slash).
 *
 * `APP_BASE_URL` wins so the OAuth redirect_uri is stable; otherwise derive it
 * from the reverse-proxy forwarded headers (homelab nginx). The redirect_uri
 * must be byte-identical between the authorize and callback legs, so both routes
 * call this with the incoming request.
 */
export function resolveBaseUrl(request: Request): string {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

/**
 * Backs `@ai-sdk/mcp`'s `auth()` and `createMCPClient({ authProvider })` with the
 * `mcp_oauth_sessions` table. One instance is scoped to a single server.
 *
 * Two usage modes:
 * - interactive (settings authorize route): `redirectToAuthorization` stashes the
 *   URL for the route to hand back to the browser.
 * - runtime (chat / connection test): a `redirectToAuthorization` call means the
 *   silent refresh failed, so we flag the session `needs_reauth` instead.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  #authorizeUrl?: string;

  constructor(
    private readonly serverId: string,
    private readonly serverUrl: string,
    private readonly baseUrl: string,
    private readonly scope: string,
    private readonly interactive = false,
  ) {}

  get redirectUrl(): string {
    // Must be a concrete string: a missing redirect_uri makes the SDK treat the
    // flow as non-interactive (client_credentials).
    return `${this.baseUrl}/api/mcp/oauth/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: "agent-chat-lab",
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Omit scope when unset so the server applies its default. Users who need a
      // refresh_token can request "offline_access" explicitly via oauthScopes;
      // forcing it here would break servers that reject the unknown scope.
      ...(this.scope ? { scope: this.scope } : {}),
    };
  }

  // --- CSRF state: generate on the authorize leg, validate on callback ---
  state(): string {
    const value = randomUUID();
    patchSession(this.serverId, {
      state: value,
      serverUrl: this.serverUrl,
      status: "pending",
    });
    return value;
  }

  saveState(state: string): void {
    patchSession(this.serverId, { state });
  }

  storedState(): string | undefined {
    return readSession(this.serverId)?.state ?? undefined;
  }

  // --- DCR client info: persist/return verbatim (it carries extra
  // authorization_server/token_endpoint keys the SDK round-trips). ---
  clientInformation(): OAuthClientInformation | undefined {
    const raw = readSession(this.serverId)?.clientInfoJson;
    return raw ? (JSON.parse(raw) as OAuthClientInformation) : undefined;
  }

  saveClientInformation(info: OAuthClientInformation): void {
    patchSession(this.serverId, { clientInfoJson: JSON.stringify(info) });
  }

  // --- tokens: saveTokens fires on first authorize and on every silent refresh ---
  tokens(): OAuthTokens | undefined {
    const raw = readSession(this.serverId)?.tokensJson;
    return raw ? (JSON.parse(raw) as OAuthTokens) : undefined;
  }

  saveTokens(tokens: OAuthTokens): void {
    // OAuthTokens only carries expires_in (seconds); derive an absolute expiry
    // for the UI badge ourselves.
    const expiresAt =
      typeof tokens.expires_in === "number"
        ? Date.now() + tokens.expires_in * 1000
        : null;
    patchSession(this.serverId, {
      tokensJson: JSON.stringify(tokens),
      expiresAt,
      status: "authorized",
    });
  }

  // --- PKCE ---
  saveCodeVerifier(codeVerifier: string): void {
    patchSession(this.serverId, { codeVerifier });
  }

  codeVerifier(): string {
    const value = readSession(this.serverId)?.codeVerifier;
    if (!value) throw new Error("Missing PKCE code_verifier for MCP OAuth session");
    return value;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    if (this.interactive) {
      this.#authorizeUrl = authorizationUrl.toString();
      return;
    }
    // Runtime path: refresh failed and consent is required again. Never navigate
    // server-side. But a concurrent request may have just refreshed successfully —
    // don't clobber a now-valid session back to needs_reauth.
    const session = readSession(this.serverId);
    if (session?.tokensJson && session.expiresAt && session.expiresAt > Date.now()) {
      return;
    }
    patchSession(this.serverId, { status: "needs_reauth" });
  }

  /** Authorize route reads this after `auth()` returns 'REDIRECT'. */
  takeAuthorizeUrl(): string | undefined {
    return this.#authorizeUrl;
  }

  async validateAuthorizationServerURL(
    _serverUrl: string | URL,
    authorizationServerUrl: string | URL,
  ): Promise<void> {
    const parsed = new URL(authorizationServerUrl);
    if (parsed.protocol !== "https:") {
      throw new Error("MCP OAuth authorization server must use https");
    }

    // The auth server URL comes from the MCP server's own metadata, so block
    // private/internal targets before discovery fetches them (SSRF defense in
    // depth). The SDK re-resolves DNS on fetch, so a residual rebinding gap
    // remains; pinning would require a custom fetch agent.
    const host = parsed.hostname;
    if (isIP(host)) {
      if (isPrivateIp(host)) {
        throw new Error("MCP OAuth authorization server resolves to a non-public address");
      }
      return;
    }

    let addresses: { address: string }[];
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      throw new Error("MCP OAuth authorization server host could not be resolved");
    }
    if (addresses.some((entry) => isPrivateIp(entry.address))) {
      throw new Error("MCP OAuth authorization server resolves to a non-public address");
    }
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): void {
    if (scope === "all") {
      patchSession(this.serverId, {
        clientInfoJson: null,
        tokensJson: null,
        expiresAt: null,
        codeVerifier: null,
        status: "needs_reauth",
      });
    } else if (scope === "client") {
      patchSession(this.serverId, { clientInfoJson: null });
    } else if (scope === "tokens") {
      // Tokens gone → the server is no longer usable; reflect that in status so
      // the UI badge doesn't keep showing "authorized".
      patchSession(this.serverId, {
        tokensJson: null,
        expiresAt: null,
        status: "needs_reauth",
      });
    } else if (scope === "verifier") {
      patchSession(this.serverId, { codeVerifier: null });
    }
  }
}
