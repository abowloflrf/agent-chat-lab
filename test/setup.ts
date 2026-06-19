// Vitest global setup: runs before any test module loads.

// Some date formatting (e.g. lib/todo-ui.ts) has no explicit timeZone and depends on the
// process TZ. Pin it so those assertions are stable on any host (matches the app's display TZ).
process.env.TZ = "Asia/Shanghai";

// Silence pino logs: tested code exercises warn/error paths (e.g. invalid skill names) that
// would otherwise flood test output. The logger reads this at init.
process.env.LOG_LEVEL = "silent";
