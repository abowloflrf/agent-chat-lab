# Repository Guidelines

## Project Structure & Module Organization
This repository is a single Next.js 16 app. Route files live in `app/`, including UI pages such as `app/page.tsx` and `app/settings/page.tsx`, and API handlers under `app/api/` (`chat`, `conversations`, `models`, `settings`, `tavily-usage`, `tool-stats`). Shared UI components live in `components/`. Agent and provider logic lives in `lib/`, with AI-specific code under `lib/ai/` and database code under `lib/db/`. Database migrations live in `drizzle/`. Runtime data (SQLite files) lives in `data/`. Static assets live in `public/`. There is no `tests/` directory yet.

## Build, Test, and Development Commands
- `pnpm dev`: start the local dev server.
- `pnpm build`: create a production build and run type checks.
- `pnpm start`: serve the built app locally.
- `pnpm lint`: run ESLint across the repository.

Run `pnpm lint && pnpm build` before opening a pull request.

## Coding Style & Naming Conventions
Use TypeScript with strict typing and 2-space indentation. Prefer functional React components and App Router conventions. Use `PascalCase` for component files (`ChatShell`), `camelCase` for helpers and variables, and lowercase route segment names in `app/`. Keep server-only logic in route handlers or `lib/`, not in client components. Styling is done with Tailwind CSS utility classes in JSX and shared base styles in `app/globals.css`.

Because this project uses Next.js 16, check the local framework docs in `node_modules/next/dist/docs/` before changing routing, layouts, or route handlers.

## Testing Guidelines
There is no dedicated test framework configured yet. Until one is added, treat `pnpm lint` and `pnpm build` as the minimum validation gate. For new logic in `lib/` or API routes, add tests when introducing a test runner, and keep test files close to the code they cover using names like `*.test.ts`.

## Documentation Maintenance
Keep `TODO.md` in sync with the codebase. When adding scope, finishing a task, or changing priorities, update `TODO.md` in the same change so the repository always reflects current project status.

## Commit & Pull Request Guidelines
Current history only contains the scaffold commit (`Initial commit from Create Next App`), so use short, imperative commit messages such as `Add provider settings page` or `Refactor chat transport`. Keep one logical change per commit when practical.

PRs should include:
- a brief summary of the change
- any config or environment updates
- screenshots for UI changes
- validation notes (`pnpm lint`, `pnpm build`)

## Security & Configuration Tips
Do not commit real API keys. Use `.env.local` for server defaults. Provider config and system settings are persisted server-side in SQLite via Drizzle ORM.
