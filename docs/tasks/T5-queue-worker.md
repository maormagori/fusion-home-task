# T5 — Queue, worker, server

**Goal:** run analysis in the background with limited concurrency, implement the retry + correction loop
(`ARCHITECTURE.md` §5.2), and wire everything in `server.ts` with startup recovery (§5.4).

## Files you own
`src/queue/analysis-queue.ts`, `src/queue/analysis-worker.ts`, `src/server.ts`,
`test/queue/analysis-queue.test.ts`, `test/queue/analysis-worker.test.ts`, `test/queue/analysis-worker.llm.test.ts`.
(`src/api/app.ts` may not be merged yet when you start; `server.ts` only needs its `buildApp` signature from `CLAUDE.md`.)

## Behavior
- `createAnalysisQueue(concurrency, process)`: wraps `p-queue`. `enqueue(id)` adds `() => process(id)` and does not
  wait for it. A job that throws is caught and logged with `console.error` (otherwise it becomes an unhandled rejection).
  `onIdle()` delegates to p-queue (used by tests).
- `processFeedback(id, { repo, llm, maxAttempts })`:
  1. `repo.transition(id, 'RECEIVED', 'ANALYZING')`; if false, return.
  2. `messages = buildInitialMessages(feedback.content)`.
  3. Up to `maxAttempts` times: `outcome = analyzeOnce(llm, messages)` → `repo.recordAttempt(...)`.
     - `success` → `transition(ANALYZING → DONE, { lastError: null })`, return.
     - `invalid_output` → `messages.push(...buildCorrectionMessages(outcome.raw, outcome.error))`.
     - `llm_error` → keep `messages` as they are (the SDK already did backoff).
  4. Out of attempts → `transition(ANALYZING → FAILED, { lastError: <latest error> })`.
  Keep this function short and readable; it is the heart of the system.
- `server.ts`: `loadConfig` → `openDatabase` → repo → LLM client → queue (`ANALYSIS_CONCURRENCY`, `processFeedback`) →
  recovery (`resetInterruptedAnalyses`, then enqueue every `RECEIVED` id) → `buildApp` → `listen` on `PORT`.
  Log how many items were recovered.

## Tests
- `analysis-queue.test.ts`: concurrency 2 with 5 slow jobs → never more than 2 in flight, all complete; a throwing job does not stop the others.
- `analysis-worker.test.ts` (no Ollama, in-memory DB, real repo):
  - item not in RECEIVED → returns without recording attempts.
  - LLM client pointed at an unused port with `maxRetries: 0` → `maxAttempts` attempts recorded, status FAILED, `lastError` set.
- `analysis-worker.llm.test.ts` (real Ollama): RECEIVED item → DONE, one attempt with `result`, `lastError` null.

## Done when
typecheck + `npm test` pass, `npm run test:llm` passes locally, `npm run dev` starts (once T4 is merged);
`docs/ai-notes/T5.md`; committed on `task/T5-queue-worker`.
