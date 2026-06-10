import "server-only";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { logger } from "@/lib/logger";
import type { McpServer } from "@/lib/provider-config";

// Each MCP connection has to complete its handshake + tool discovery within
// this budget. The chat route runs under a 60s ceiling, so a single slow or
// unreachable server must not stall the whole request.
const MCP_CONNECT_TIMEOUT_MS = 8000;

export type McpToolBundle = {
  tools: ToolSet;
  close: () => Promise<void>;
};

function headersToRecord(server: McpServer): Record<string, string> | undefined {
  const entries = server.headers.filter((header) => header.key);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries.map((header) => [header.key, header.value]));
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
      reject(new Error(`${label} 连接超时（${ms}ms）`));
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

/**
 * Connect to every enabled MCP server over Streamable HTTP and merge their
 * tools into a single tool set.
 *
 * A server that fails to connect or list tools is skipped (logged, not thrown)
 * so it never blocks the conversation. Tools from later servers override
 * earlier ones with the same name. Always call `close()` once the stream is
 * finished or errors out to release the connections.
 */
export async function connectMcpServers(servers: McpServer[]): Promise<McpToolBundle> {
  const clients: MCPClient[] = [];
  const tools: ToolSet = {};

  await Promise.all(
    servers.map(async (server) => {
      let client: MCPClient | undefined;

      try {
        client = await withTimeout(
          createMCPClient({
            transport: {
              type: "http",
              url: server.url,
              headers: headersToRecord(server),
            },
          }),
          MCP_CONNECT_TIMEOUT_MS,
          server.name,
          (lateClient) => {
            void lateClient.close().catch(() => {});
          },
        );

        const serverTools = await withTimeout(
          client.tools(),
          MCP_CONNECT_TIMEOUT_MS,
          server.name,
        );

        clients.push(client);
        Object.assign(tools, serverTools);
      } catch (error) {
        void client?.close().catch(() => {});
        logger.warn(
          {
            mcpServer: server.name,
            url: server.url,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to connect MCP server; skipping",
        );
      }
    }),
  );

  let closed = false;

  return {
    tools,
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}
