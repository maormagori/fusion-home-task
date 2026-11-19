# T8 — Minimal UI

**When:** only after T6 is merged, so the UI is built on a backend already proven end to end.

**Goal:** a small, clean web page to submit feedback and watch it move through the state machine, built on the
API contract from T4. The challenge says UI polish is not graded, so keep it minimal: one page, no routing library,
no state-management library, no component library. Clarity and correctness over visuals.

**Agent:** Claude Code (not Codex): it needs the `ui-ux-pro-max` skill and the Playwright MCP.

**Use the `ui-ux-pro-max` skill** ([nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill),
installed at `~/.claude/skills/ui-ux-pro-max`). Invoke it before writing UI code and run its search/recommendation scripts
for this product type (internal admin / feedback dashboard, minimal style, React + plain CSS) to pick a simple, accessible style: palette,
typography, spacing, status-badge colors, and light/dark support. Record what it recommended and what you kept in your ai-notes.

## Files you own
`web/` (everything inside), `vite.config.ts` or `web/vite.config.ts`, `web/tsconfig.json`,
`package.json` (scripts + dependencies only), `package-lock.json`, `.github/workflows/ci.yml` (add one build step),
`src/api/app.ts` (only to serve the built UI, see below), `src/api/feedback.routes.ts` + `src/api/feedback.schemas.ts`
(only the `GET /config` route and its schema), `test/api/static-ui.test.ts`, `test/api/config.test.ts`.

## Stack
- Vite + React + TypeScript, dependencies in the **root** `package.json` (one `npm install` for everything).
- Plain CSS (one stylesheet with CSS variables for the theme). No Tailwind, no UI kit.
- `fetch` wrapped in one small `web/src/api.ts` module (one function per endpoint).

## Single source of models (hard rule)
The backend owns every model; the UI only imports them.
- Request/response types: `import type` from `src/api/feedback.schemas.ts` (`z.infer` of the route schemas) and
  `src/domain/types.ts`. `web/src/api.ts` functions are typed with these, e.g. `Promise<FeedbackDetail>`.
- Runtime values come from the backend too: status filter options and badges iterate `FEEDBACK_STATUSES`; sentiment
  values come from `analysisResultSchema`. No string literal list of statuses or sentiments in `web/`.
- `MAX_CONTENT_LENGTH` is server config, so the UI must not hard-code it: add `GET /config` → `{ maxContentLength }`
  (response schema in `feedback.schemas.ts`, route in `feedback.routes.ts`, value from `buildApp` deps) and the
  form reads it from there.
- `web/` contains **no** `interface` or `type` describing feedback, attempts, analysis, statuses, or API bodies.
  UI-only types (component props, local view state) are fine. The manager checks this in review.
- Only modules with no server-only imports (no db, Fastify, openai, node:*) may be imported at runtime; Vite will
  fail the build otherwise, which is the check.

## Behavior
1. **Submit form:** textarea + submit button; shows the `MAX_CONTENT_LENGTH` limit as a character counter
   (limit read from `GET /config`); disables the button while sending.
   On 202 → "Submitted, analyzing…". On 200 duplicate → "This feedback was already submitted" and highlight that item.
   On 400 → show the error message from the API.
2. **List:** newest first, from `GET /feedback`. Each row: content preview, status badge
   (RECEIVED / ANALYZING / DONE / FAILED, each with a distinct color *and* text), created time, attempt count.
   Status filter (All + the 4 statuses). Simple "Load more" or prev/next with `limit`/`offset`.
3. **Live updates:** poll the list every 2s **only while** any visible item is RECEIVED or ANALYZING; stop otherwise.
4. **Detail panel** (click a row → `GET /feedback/:id`):
   - DONE: sentiment, feature requests with confidence shown as a percentage or bar, actionable insight.
   - FAILED: `lastError` and a **Retry** button (`POST /feedback/:id/retry`); 409 → show the message.
   - Attempts list (collapsible): attempt number, error, raw response in a `<pre>`.
5. Empty, loading, and error states for the list and detail. Basic accessibility: labels, focus states, keyboard-usable rows.

## Running it
- **Dev:** `npm run dev` (API on :3000) + `npm run web:dev` (Vite, proxies `/feedback` to `http://localhost:3000`, so no CORS).
- **Built:** `npm run web:build` writes `web/dist`. `buildApp` serves it with `@fastify/static` at `/` **only if
  `web/dist` exists**, so API tests and CI without a UI build keep working. Add a `uiDistPath?: string` option to
  `buildApp`'s deps rather than reading the filesystem path inside routes; `server.ts` passes it (ask the coordinator
  before editing `server.ts`).
- Scripts: `web:dev`, `web:build`, `web:typecheck`. CI: add `npm run web:typecheck && npm run web:build`.

## Tests / evidence
- `test/api/static-ui.test.ts`: with a temp folder containing `index.html`, `GET /` returns it; API routes still work.
- `npm run web:typecheck` and `npm run web:build` pass.
- Run the app against real Ollama and take Playwright screenshots (use the Playwright MCP tools) of: empty state,
  an item ANALYZING, a DONE item's detail, a FAILED item with the Retry button. Save them to `docs/screenshots/`
  and reference them in the PR TL;DR.

## Done when
CI green (including the web build), screenshots committed, `docs/ai-notes/T8.md` written (including what `ui-ux-pro-max`
suggested and what was kept or dropped, and why), PR open with the TL;DR.
