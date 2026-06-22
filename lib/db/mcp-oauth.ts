import "server-only";

import { eq, inArray, notInArray } from "drizzle-orm";
import { db, ensureDatabase } from "@/lib/db/client";
import { mcpOAuthSessions } from "@/lib/db/schema";

export type McpOAuthStatus = "unauthorized" | "pending" | "authorized" | "needs_reauth";

export type McpOAuthSessionRow = typeof mcpOAuthSessions.$inferSelect;

// Fields a caller may patch. `null` explicitly clears a column.
export type McpOAuthSessionPatch = Partial<{
  clientInfoJson: string | null;
  tokensJson: string | null;
  expiresAt: number | null;
  codeVerifier: string | null;
  state: string | null;
  serverUrl: string | null;
  status: McpOAuthStatus;
}>;

export function readSession(serverId: string): McpOAuthSessionRow | undefined {
  return db
    .select()
    .from(mcpOAuthSessions)
    .where(eq(mcpOAuthSessions.serverId, serverId))
    .all()[0];
}

export function findServerByState(state: string): McpOAuthSessionRow | undefined {
  if (!state) return undefined;
  return db
    .select()
    .from(mcpOAuthSessions)
    .where(eq(mcpOAuthSessions.state, state))
    .all()[0];
}

// Upsert a partial session. Runs synchronously (better-sqlite3) so OAuth state
// is durably committed before the start route returns and redirects the browser.
export function patchSession(serverId: string, patch: McpOAuthSessionPatch): void {
  const now = Date.now();
  const existing = readSession(serverId);

  if (existing) {
    db.update(mcpOAuthSessions)
      .set({ ...patch, updatedAt: now })
      .where(eq(mcpOAuthSessions.serverId, serverId))
      .run();
    return;
  }

  db.insert(mcpOAuthSessions)
    .values({
      serverId,
      clientInfoJson: patch.clientInfoJson ?? null,
      tokensJson: patch.tokensJson ?? null,
      expiresAt: patch.expiresAt ?? null,
      codeVerifier: patch.codeVerifier ?? null,
      state: patch.state ?? null,
      serverUrl: patch.serverUrl ?? null,
      status: patch.status ?? "unauthorized",
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function deleteSession(serverId: string): void {
  db.delete(mcpOAuthSessions).where(eq(mcpOAuthSessions.serverId, serverId)).run();
}

// Drop sessions for servers that no longer exist (called when settings are saved).
// An empty list means "no servers" → wipe all rows.
export function deleteSessionsNotIn(serverIds: string[]): void {
  if (serverIds.length === 0) {
    db.delete(mcpOAuthSessions).run();
    return;
  }
  db.delete(mcpOAuthSessions).where(notInArray(mcpOAuthSessions.serverId, serverIds)).run();
}

export type McpOAuthStatusInfo = { status: McpOAuthStatus; expiresAt: number | null };

// Status map for the settings UI badges. Servers with no row default to "unauthorized".
export async function getMcpOAuthStatuses(
  serverIds: string[],
): Promise<Record<string, McpOAuthStatusInfo>> {
  await ensureDatabase();
  const result: Record<string, McpOAuthStatusInfo> = {};
  if (serverIds.length === 0) return result;

  const rows = db
    .select()
    .from(mcpOAuthSessions)
    .where(inArray(mcpOAuthSessions.serverId, serverIds))
    .all();

  for (const id of serverIds) {
    result[id] = { status: "unauthorized", expiresAt: null };
  }
  for (const row of rows) {
    let status = (row.status as McpOAuthStatus) ?? "unauthorized";
    // Defensive: an "authorized" row with no token is unusable at runtime
    // (e.g. tokens were invalidated) — surface it as needs_reauth, not authorized.
    if (status === "authorized" && !row.tokensJson) {
      status = "needs_reauth";
    }
    result[row.serverId] = { status, expiresAt: row.expiresAt ?? null };
  }
  return result;
}
