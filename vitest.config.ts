import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Repo root (trailing "/"), used to resolve the "@/..." path alias.
const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // Tests live next to their source: lib/foo.ts <-> lib/foo.test.ts.
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    // Import describe/it/expect explicitly from "vitest" instead of relying on globals.
    globals: false,
    // Pin timezone + silence logs for host-independent, clean output.
    setupFiles: ["./test/setup.ts"],
  },
  resolve: {
    alias: [
      // "server-only" throws outside RSC; stub it with an empty module.
      {
        find: /^server-only$/,
        replacement: `${rootDir}test/stubs/server-only.ts`,
      },
      // Mirror tsconfig's "@/*" -> "./*" alias.
      { find: "@/", replacement: rootDir },
    ],
  },
});
