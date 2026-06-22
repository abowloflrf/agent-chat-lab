import { auth } from "@ai-sdk/mcp";
import { McpOAuthProvider, resolveBaseUrl } from "@/lib/ai/mcp-oauth";
import { invalidateMcpCache } from "@/lib/ai/mcp";
import { findServerByState, patchSession } from "@/lib/db/mcp-oauth";
import { getSystemSettings } from "@/lib/settings";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

// MCP settings live under the "tools" section; the form reads ?mcpOAuth on load.
const SETTINGS_PATH = "/settings/tools";

// OAuth authorization-server redirect target. Exchanges the code for tokens via
// @ai-sdk/mcp's auth(), then bounces back to the settings page with a result flag.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const baseUrl = resolveBaseUrl(request);

  const redirectBack = (status: "success" | "error", serverId?: string) => {
    const target = new URL(`${baseUrl}${SETTINGS_PATH}`);
    target.searchParams.set("mcpOAuth", status);
    if (serverId) target.searchParams.set("server", serverId);
    return Response.redirect(target.toString(), 302);
  };

  const row = state ? findServerByState(state) : undefined;

  if (oauthError || !code || !state || !row) {
    logger.warn(
      { oauthError, hasCode: Boolean(code), hasState: Boolean(state), matchedServer: Boolean(row) },
      "MCP OAuth callback rejected before token exchange",
    );
    if (row) patchSession(row.serverId, { status: "needs_reauth" });
    return redirectBack("error", row?.serverId);
  }

  const settings = await getSystemSettings();
  const server = settings.mcpServers.find((item) => item.id === row.serverId);

  // Reject if the server was deleted or re-addressed mid-flow.
  if (!server || server.authType !== "oauth" || server.url !== row.serverUrl) {
    logger.warn(
      { serverId: row.serverId, exists: Boolean(server), urlChanged: server ? server.url !== row.serverUrl : null },
      "MCP OAuth callback: server missing or re-addressed mid-flow",
    );
    patchSession(row.serverId, { status: "needs_reauth" });
    return redirectBack("error", row.serverId);
  }

  const provider = new McpOAuthProvider(server.id, server.url, baseUrl, server.oauthScopes, true);

  try {
    const result = await auth(provider, {
      serverUrl: server.url,
      authorizationCode: code,
      callbackState: state,
    });

    if (result !== "AUTHORIZED") {
      throw new Error("authorization not completed");
    }

    // saveTokens already set status=authorized; clear transient PKCE/state.
    patchSession(server.id, { codeVerifier: null, state: null });
    // Drop any cached client bound to the previous identity so the next request
    // reconnects with the freshly authorized token.
    invalidateMcpCache(server.id);
    return redirectBack("success", server.id);
  } catch (error) {
    logger.warn(
      {
        mcpServer: server.name,
        serverId: server.id,
        url: server.url,
        error: error instanceof Error ? error.message : String(error),
      },
      "MCP OAuth callback token exchange failed",
    );
    patchSession(server.id, { status: "needs_reauth", codeVerifier: null, state: null });
    return redirectBack("error", server.id);
  }
}
