import { getSystemSettings, saveSystemSettings } from "@/lib/settings";
import { getMcpOAuthStatuses } from "@/lib/db/mcp-oauth";

export const runtime = "nodejs";

export async function GET() {
  const settings = await getSystemSettings();
  // OAuth status per server (for the settings badges); keyed by server id.
  const oauthServerIds = settings.mcpServers
    .filter((server) => server.authType === "oauth")
    .map((server) => server.id);
  const mcpOAuth = await getMcpOAuthStatuses(oauthServerIds);
  return Response.json({ settings, mcpOAuth });
}

export async function PUT(request: Request) {
  try {
    const json = await request.json();
    const settings = await saveSystemSettings(json);
    // Return refreshed OAuth statuses too: saving may have dropped sessions
    // (URL changed / switched to Header), and the UI badges must reflect that.
    const oauthServerIds = settings.mcpServers
      .filter((server) => server.authType === "oauth")
      .map((server) => server.id);
    const mcpOAuth = await getMcpOAuthStatuses(oauthServerIds);
    return Response.json({ settings, mcpOAuth });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Failed to save settings.",
      },
      { status: 400 },
    );
  }
}
