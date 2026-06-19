# ShuFang (书房) — agent guide

## Quick start

```bash
npm run dev             # starts both server (:4141) and Vite (:5173) concurrently
npm run dev:server      # server only (tsx watch, :4141)
npm run dev:web         # Vite only (:5173)
npm run build           # tsc -b && vite build
npm run typecheck       # tsc -b --pretty false (both apps)
```

Run a single workspace: `npm run <script> -w @shufang/web` or `-w @shufang/server`.

## Repo layout

- `apps/server` — Fastify backend (SQLite, better-sqlite3). Entrypoint: `src/index.ts`.
- `apps/web` — React SPA (Vite). Entrypoint: `src/main.tsx` (4372-line single file).
- `packages/` — reserved for future shared packages, does not exist yet.
- `scratch/` — prototyping sketches, not part of the app.
- `apps/server/data/` — runtime SQLite DB + covers (gitignored).

## Architecture notes

- Entire frontend is one TSX file with inline components and state-based view switching (no router library).
- Server is largely one file (`index.ts`, 788 lines) with `// @ts-nocheck`.
- Database auto-creates schema + seeds demo users on first run.
- UI is in Simplified Chinese; server error messages are Chinese.
- Podcasts fetched live from Apple iTunes RSS (not stored locally).
- Cover images extracted at scan time, stored in `data/covers/`.
- Audio/book files streamed with HTTP range requests.

## No tests / no lint / no formatter / no CI

There are zero test files, test configs, or test dependencies. No ESLint, Prettier, Biome, or any linter/formatter. No CI workflows or pre-commit hooks.

## Notable quirks

- `// @ts-nocheck` at the top of `apps/server/src/index.ts` — type checking disabled for that file.
- SMB support was added then removed (`beace76`). `task.md` documents integration details but the code is gone.
- `workspaces` in root `package.json` lists `packages/*` but the directory does not yet exist.
