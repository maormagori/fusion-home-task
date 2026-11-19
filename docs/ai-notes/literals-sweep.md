Agent / model: Codex, GPT-6 (exact runtime variant and effort not exposed)

# Literals sweep

## Prompts that mattered
- Audit `src/` and `test/` on the integration branch and PR #6 without editing code; propose only obvious sources of truth. This produced the row list used for approval.
- Apply B1–B5, C1–C6 except C7, and D1, D3–D5; skip D2. The coordinator specified a separate sentiment schema, `http-status-codes`, encoded URL builders, and a branch based on PR #6.
- Keep the changes mechanical, preserve prompt wording, and leave config-default assertions independent.

## Where the AI was wrong / low quality and how it was corrected
- The audit proposed reading physical table names from Drizzle in migration assertions. The owner rejected this because independent assertions should catch a wrong table name; those tests retain literal expected names.
- The initial package installation removed unrelated optional lockfile entries. Restored the existing entries and retained only the new dependency and its package record.
- The brief originally prohibited lockfile commits. The later instruction required a dependency and allowed fixing installation failures: `npm ci --dry-run --ignore-scripts` with the original lockfile failed because `http-status-codes@2.3.0` was missing. The minimal lockfile update makes that check pass.

## Shortcuts / tradeoffs taken
- Built on PR #6 as instructed. After #6 merged, merged the integration branch into this branch without a force push, so the PR contains only this sweep.
- Existing API error constants are exported from the routes module. Paths and URL builders live in the existing API schemas module for consumers that do not import the server.
- Ordinary fixture text, numeric scenario values, invalid enum samples, config-default assertions, log text, and switch tags remain literal. The schema name already had a constant.
- Existing tests exercise the mechanical replacements; one focused URL-builder check verifies encoding of reserved characters.

## Walkthrough for the owner
- `src/analysis/analysis.schema.ts` — exports the sentiment enum separately and reuses it in the result schema. Tests and the system prompt read its values directly.
- `src/analysis/prompt.ts` — exports existing feedback delimiters and a correction instruction. The generated message wording remains identical.
- `src/api/feedback.schemas.ts` — owns route paths and builders that encode an id as one path segment. Tests use these alongside the existing paging limit constants.
- `src/api/app.ts` and `src/api/feedback.routes.ts` — use `StatusCodes` for replies and response-schema keys; routes export their existing API error constants.
- `src/db/database.ts` — exports the existing in-memory path for DB-backed tests.
- `test/` — status and sentiment fixtures use schemas; API expectations use exported messages, paths, HTTP codes, and paging limits. Queue concurrency setup and expectation share one local constant.
- `CLAUDE.md` — records the selected HTTP-code and API-path sources.
- How to see it work: `npm ci`, `npm run typecheck`, and `npm test`. Live-model checks are available via `npm run test:llm` when Ollama is running.

## Verification
- `npm ci --dry-run --ignore-scripts` passes with the minimal dependency lock update.
- `npm run typecheck` passes; `npm test` passes 73 tests across 10 files.
- Live-model tests were not run; this sweep changes their constants, not their model calls.
