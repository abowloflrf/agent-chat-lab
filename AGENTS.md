# Repository Guidelines

## Project Structure & Module Organization
This repository is a single Next.js 16 app. Route files live in `app/`, including UI pages such as `app/page.tsx`, `app/login/page.tsx`, and `app/settings/page.tsx`, plus app metadata routes like `app/manifest.ts` and static app icons (`app/favicon.ico`, `app/apple-icon.png`, with PWA icons in `public/`). API handlers live under `app/api/` (`auth`, `chat`, `conversations`, `conversations/[id]/title`, `models`, `settings`, `skills`, `tavily-usage`, `tool-stats`). Shared UI components live in `components/`. Agent and provider logic lives in `lib/`, with AI-specific code under `lib/ai/`, database code under `lib/db/`, and persistence/settings helpers alongside them. Database migrations live in `drizzle/`. Runtime data lives in `data/` (SQLite files) and `workspace/` (the agent's Bash/file working directory); both are git-ignored, volume-mounted, user-controlled, and never baked into the image. Reusable agent skills live under `workspace/skills/` (one `SKILL.md` per subdirectory), discovered at request time; the location can be overridden with the `SKILLS_DIR` env var. Design notes live in `docs/`. Static assets live in `public/`. Build-time scripts such as the static app-icon generator live in `scripts/`. Deployment-related files include `Dockerfile` and `docker-compose.yml`. There is no `tests/` directory yet.

## Build, Test, and Development Commands
- `pnpm dev`: start the local dev server.
- `pnpm build`: create a production build and run type checks.
- `pnpm start`: serve the built app locally.
- `pnpm lint`: run ESLint across the repository.
- `pnpm db:generate`: regenerate Drizzle migration files from the current schema.
- `pnpm generate:icons`: re-render the static app icons (`favicon.ico`, `apple-icon.png`, PWA icons) from `scripts/generate-icons.mjs`.

Run `pnpm lint && pnpm build` before opening a pull request.

## Coding Style & Naming Conventions
Use TypeScript with strict typing and 2-space indentation. Prefer functional React components and App Router conventions. Use `PascalCase` for component files (`ChatShell`), `camelCase` for helpers and variables, and lowercase route segment names in `app/`. Keep server-only logic in route handlers or `lib/`, not in client components. Styling is done with Tailwind CSS utility classes in JSX and shared base styles in `app/globals.css`.

Because this project uses Next.js 16, check the local framework docs in `node_modules/next/dist/docs/` before changing routing, layouts, or route handlers.

## Testing Guidelines
There is no dedicated test framework configured yet. Until one is added, treat `pnpm lint` and `pnpm build` as the minimum validation gate. For new logic in `lib/` or API routes, add tests when introducing a test runner, and keep test files close to the code they cover using names like `*.test.ts`.

## Documentation Maintenance
Keep `TODO.md` and `CHANGELOG.md` in sync with the codebase, but do not update them too frequently for minor routine changes. `TODO.md` should contain only meaningful unfinished work, while completed work and significant code improvements should be recorded in `CHANGELOG.md`. Only update these files for key code changes, feature updates, important fixes, scope changes, or priority changes; ordinary small fixes or low-impact refactors do not need to be recorded. When such tracked changes happen, update the relevant file in the same change so the repository always reflects current project status. If repository guidance changes materially, update `AGENTS.md` in the same pass.

## Commit & Pull Request Guidelines
Use short, imperative commit messages such as `Add provider settings page` or `Refactor chat transport`. Keep one logical change per commit when practical.

PRs should include:
- a brief summary of the change
- any config or environment updates
- screenshots for UI changes
- validation notes (`pnpm lint`, `pnpm build`)

## Security & Configuration Tips
This app is exposed to the public internet. All routes are protected by a static password authentication layer implemented in `proxy.ts`:
- **Page routes**: unauthenticated requests are rewritten to `/login` at the proxy level, so no real page content is server-rendered or leaked.
- **API routes**: unauthenticated requests receive a 401 response. The only public API exception is `/api/auth` for login. The static icon/manifest routes (`/apple-icon`, `/manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`) are also allowed through for PWA support.
- **Auth token**: stored as an HttpOnly cookie (`auth_token`), validated against `SHA-256(AUTH_PASSWORD)`.

When adding new API routes or pages, they are automatically protected by the proxy. If a new route must be publicly accessible (like `/api/auth` or `/login`), explicitly exclude it in the `proxy.ts` logic.

Do not commit real API keys. Use `.env.local` for server defaults. Provider config and system settings are persisted server-side in SQLite via Drizzle ORM.
