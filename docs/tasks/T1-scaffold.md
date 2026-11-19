# T1 — Scaffold + contracts

**Goal:** a project that installs, type-checks, runs tests, and creates the database, with the shared
types and output schema from `CLAUDE.md` → Contracts in place, so T2 and T3 can start in parallel.

## Files you own
`package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts` (+ a second config for LLM tests if needed),
`drizzle.config.ts`, `.gitignore` (append only), `.env.example`, `.github/workflows/ci.yml`,
`src/config.ts`, `src/domain/types.ts`, `src/analysis/analysis.schema.ts`, `src/db/schema.ts`, `src/db/database.ts`,
`drizzle/` (generated), `test/db/database.test.ts`, `test/config.test.ts`, `test/analysis/analysis.schema.test.ts`.

## Steps
1. `npm init`, ESM (`"type": "module"`), Node 24. Install the stack listed in `CLAUDE.md` (latest stable versions).
   Add the scripts listed under **Commands** in `CLAUDE.md`.
2. `tsconfig.json`: `strict`, `module`/`moduleResolution` `NodeNext`, `outDir: dist`, `rootDir: .` (tests are type-checked too).
3. Vitest: `npm test` runs `test/**/*.test.ts` **excluding** `*.llm.test.ts`; `npm run test:llm` runs only `*.llm.test.ts`.
4. `src/config.ts`: `loadConfig(env = process.env): Config`, validated with Zod, all variables and defaults from
   `ARCHITECTURE.md` §7. Use `z.coerce.number()` for numeric values. Write `.env.example` with the same defaults.
   Do not add a dotenv dependency.
5. `src/domain/types.ts` and `src/analysis/analysis.schema.ts`: copy the contracts from `CLAUDE.md` exactly.
6. `src/db/schema.ts` (Drizzle, sqlite-core):
   - `feedback`: columns per `ARCHITECTURE.md` §3; `content_hash` unique; `status` with a CHECK constraint on the 4 values; index on `status`.
   - `analysis_attempts`: columns per §3; FK to `feedback.id`; unique `(feedback_id, attempt_number)`.
   - Store timestamps as ISO text. Store `result_json` as text.
7. `src/db/database.ts`: `openDatabase(path: string): Database` — opens better-sqlite3, sets `journal_mode = WAL` and
   `foreign_keys = ON`, runs Drizzle `migrate()` from `./drizzle`, returns the Drizzle instance.
   Export `type Database` (the Drizzle `BetterSQLite3Database<typeof schema>` type). Create the parent directory of the file path if missing (not for `:memory:`).
8. `npm run db:generate` and commit the generated migration.
9. Add `node_modules/`, `dist/`, `data/`, `.env` to `.gitignore`.
10. `.github/workflows/ci.yml`: on `pull_request` (any base) and `push` to `main` and `home-task-orchestration-plan`.
    One job on `ubuntu-latest`: `actions/setup-node` (Node 24, npm cache) → `npm ci` → `npm run typecheck` → `npm test`.
    No LLM tests and no Ollama in CI. Keep it short (~20 lines).

## Tests
- `openDatabase(':memory:')` creates both tables; inserting a bad status fails the CHECK.
- `loadConfig({})` returns the defaults; a non-numeric `PORT` throws.
- `analysisResultSchema` accepts a valid sample and rejects an extra key.

## Done when
`npm install && npm run typecheck && npm test` pass on a clean clone; `docs/ai-notes/T1.md` written;
PR from `task/T1-scaffold` into `home-task-orchestration-plan` with CI green (this PR is the first CI run).
