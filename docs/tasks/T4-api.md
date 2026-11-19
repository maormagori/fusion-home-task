# T4 — HTTP API

**Goal:** Fastify routes for submit, list, get, and retry, built by `buildApp(deps)` so they can be tested
with `app.inject()` and wired in `server.ts` (T5).

## Files you own
`src/api/app.ts`, `src/api/feedback.routes.ts`, `test/api/feedback.routes.test.ts`.

## Behavior
- `buildApp({ repo, enqueue, maxContentLength })`: Fastify with logger, `fastify-type-provider-zod`
  (validator + serializer compilers), registers the feedback routes. Validation errors → 400 `{ error: string }`.
- `POST /feedback` body `{ content: string }` — trimmed, min 1, max `maxContentLength`.
  - New → `enqueue(id)`, **202** `{ id, status, duplicate: false }`.
  - Duplicate → **200** `{ id, status, duplicate: true }` (no enqueue, whatever the status).
- `GET /feedback` query `status?` (enum), `limit` (1..100, default 20), `offset` (≥ 0, default 0)
  → 200 `{ items: FeedbackView[], limit, offset }`.
- `GET /feedback/:id` → 200 `FeedbackDetail`, or 404 `{ error: 'Feedback not found' }`.
- `POST /feedback/:id/retry` → 404 if unknown; `repo.transition(id, 'FAILED', 'RECEIVED')`; if false → 409
  `{ error: 'Only FAILED feedback can be retried', status }`; else `enqueue(id)` and **202** `{ id, status: 'RECEIVED' }`.
- Routes contain no business logic beyond this; they call the repository and `enqueue`.

## Tests (`app.inject()`, real repository on `openDatabase(':memory:')`, `enqueue = vi.fn()`)
- Submit: 202 + enqueued; duplicate → 200, `duplicate: true`, not enqueued again; empty / whitespace / too long → 400.
- List: returns items with `analysis: null` while RECEIVED; status filter works; bad `limit` → 400.
- Get: 200 with `attempts: []`; unknown id → 404.
- Retry: on a FAILED item (set up via `repo.transition` RECEIVED→ANALYZING→FAILED) → 202 + enqueued; on RECEIVED → 409; unknown → 404.

## Done when
typecheck + tests pass; `docs/ai-notes/T4.md`; committed on `task/T4-api`.
