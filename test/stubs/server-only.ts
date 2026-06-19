// The real "server-only" package throws outside a React Server environment. Tests run in
// plain Node, so vitest.config.ts aliases it to this empty module, letting server-side
// modules be imported directly.
export {};
