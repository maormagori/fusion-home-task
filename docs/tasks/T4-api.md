# T4 — HTTP API

**Goal:** Fastify routes for submit, list, get, and retry, built by `buildApp(deps)` so they can be tested
with `app.inject()` and wired in `server.ts` (T5).

## Files you own
`src/api/app.ts`, `src/api/feedback.routes.ts`, `src/api/feedback.schemas.ts`, `test/api/feedback.routes.test.ts`.

## API schemas (requests **and** responses)
A UI may be added later, so the API's request and response shapes are an explicit, importable contract.
- `src/api/feedback.schemas.ts` holds every Zod schema the routes use: request body, query, params, and one
  **response** schema per status code (`202`, `200`, `404`, `409`, `400`). Name them by meaning
  (`submitFeedbackResponseSchema`, `feedbackListResponseSchema`, `feedbackDetailSchema`, `errorResponseSchema`, …).
- Reuse, don't redefine: build `analysis` from `analysisResultSchema` and status from `FEEDBACK_STATUSES`.
- Tie the response schemas to the domain types so they cannot drift: annotate them as `z.ZodType<FeedbackView>`,
  `z.ZodType<FeedbackDetail>` (or use `satisfies`), so a mismatch is a compile error.
- Every route declares `schema: { body/querystring/params, response: { <code>: schema } }`. Fastify then serializes
  through these schemas, so a response that does not match the contract fails instead of leaking extra fields.
- This file must import nothing server-only (no db, no Fastify), so a UI can `import type` from it later.

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
- Contract: a DONE item (set up via `recordAttempt` with a valid result + transitions) is returned by list and get with
  `analysis` matching `analysisResultSchema`, and each response body parses with its declared response schema.

## Done when
typecheck + tests pass; `docs/ai-notes/T4.md`; committed on `task/T4-api`.
