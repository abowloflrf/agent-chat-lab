import { auth } from "@ai-sdk/mcp";
import { McpOAuthProvider, resolveBaseUrl } from "@/lib/ai/mcp-oauth";
import { invalidateMcpCache } from "@/lib/ai/mcp";
import { patchSession, readSession } from "@/lib/db/mcp-oauth";
import { getSystemSettings } from "@/lib/settings";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

// Begin an interactive OAuth authorization for a saved MCP server. Runs discovery
// + dynamic client registration + PKCE, then returns the authorization URL for
// the browser to navigate to. The actual token exchange happens in the callback.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const serverId = typeof body?.serverId === "string" ? body.serverId.trim() : "";

  if (!serverId) {
    return Response.json({ error: "缺少 serverId。" }, { status: 400 });
  }

  const settings = await getSystemSettings();
  const server = settings.mcpServers.find((item) => item.id === serverId);

  if (!server || server.authType !== "oauth") {
    return Response.json({ error: "未找到该 OAuth MCP Server。" }, { status: 404 });
  }

  const baseUrl = resolveBaseUrl(request);
  const provider = new McpOAuthProvider(server.id, server.url, baseUrl, server.oauthScopes, true);

  // The start route is only reached by an explicit (re)authorize click, so always
  // force a fresh consent: clear the stored token/PKCE so auth() runs the full
  // authorization redirect instead of silently returning AUTHORIZED. This lets the
  // user switch account, re-consent, change scope, or fix missing permissions.
  // (Abandoning a re-auth therefore drops the old token; the enabled button lets
  // the user simply re-click to recover.)
  const existing = readSession(server.id);
  patchSession(server.id, {
    tokensJson: null,
    expiresAt: null,
    codeVerifier: null,
    state: null,
    // needs_reauth implies client info pinned to a rotated authorization server —
    // re-run dynamic registration; otherwise keep the already-registered client.
    ...(existing?.status === "needs_reauth" ? { clientInfoJson: null } : {}),
  });
  // Drop any cached client using the now-cleared token.
  invalidateMcpCache(server.id);

  try {
    const result = await auth(provider, { serverUrl: server.url });

    if (result === "AUTHORIZED") {
      // auth() may have silently refreshed; return the fresh expiry for the badge.
      const session = readSession(server.id);
      return Response.json({
        authorizeUrl: null,
        alreadyAuthorized: true,
        expiresAt: session?.expiresAt ?? null,
      });
    }

    const authorizeUrl = provider.takeAuthorizeUrl();
    if (!authorizeUrl) {
      patchSession(server.id, { status: "unauthorized" });
      return Response.json({ error: "未能获取授权地址。" }, { status: 502 });
    }

    return Response.json({ authorizeUrl });
  } catch (error) {
    patchSession(server.id, { status: "unauthorized" });
    const message =
      error instanceof Error ? error.message : "发起 OAuth 授权失败。";
    logger.warn(
      { mcpServer: server.name, serverId: server.id, url: server.url, error: message },
      "MCP OAuth authorize start failed",
    );
    return Response.json({ error: message.slice(0, 300) }, { status: 502 });
  }
}
