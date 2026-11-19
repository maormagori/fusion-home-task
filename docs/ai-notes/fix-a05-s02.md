Agent / model: Codex, GPT-6
# fix-a05-s02 — Empty replies and atomic analysis completion

## Prompts that mattered
- “An empty-string completion is invalid output” → preserve the exact raw string for validation and correction; null content and no choices remain LLM errors.
- “A successful attempt and DONE are written in one transaction” → add `completeAnalysis` and use it in the worker success branch.
- “Highest attempt_number, not MAX(result_json)” → count attempts and select the latest valid attempt number in the same aggregate, then join that attempt for its JSON.

## Where the AI was wrong / low quality and how it was corrected
- The existing client used a truthiness check, treating an empty reply as transport failure → check only null or undefined content.
- The existing worker saved success before changing status, allowing a crash to leave an unfinished item with a valid result → wrap the conditional transition and attempt write in one repository transaction.
- The existing read query assumed there could only be one valid result and compared JSON text → select by the highest valid attempt number, including for historical rows.
- The first query edit put its conditional aggregate on a long line → use a short SQL FILTER expression instead.

## Shortcuts / tradeoffs taken
- `completeAnalysis` returns a discriminated union: completed true includes the attempt; completed false includes null. It checks the transition first inside the transaction, so rejection writes nothing; insertion failure rolls back the transition.
- Reuse `transition` and `recordAttempt`; the latter's nested transaction is a savepoint inside the outer completion transaction.
- Response edge cases use a spy at the SDK completion boundary with the real LLM client and analyzer, without a fake LlmClient or model dependency. The real Ollama suite still tests model behavior.
- A database trigger in the repository test forces an insert failure to prove rollback; production code has no fault-injection hooks.

## Walkthrough for the owner
- `src/analysis/llm-client.ts` — returns empty strings unchanged so the analyzer rejects them as invalid JSON and the existing worker sends correction messages.
- `src/feedback/feedback.repository.ts` — `completeAnalysis` makes success atomic and clears lastError. The list/detail view query joins the highest valid attempt number, while counting all attempts.
- `src/queue/analysis-worker.ts` — success uses `completeAnalysis` and logs DONE only after completion succeeds; unsuccessful outcomes keep the existing retry behavior.
- `test/analysis/analyzer.test.ts` — empty string yields invalid_output with raw empty string; null content and no choices yield llm_error.
- `test/feedback/feedback.repository.test.ts` — tests success, rejection in every non-ANALYZING status, transaction rollback, and historical valid results in conflicting JSON and insertion order with a later invalid attempt.
- `CLAUDE.md` and `docs/ARCHITECTURE.md` — describe the new method, atomic success, latest-attempt reads, and empty response handling.
- How to see it work: `npm run typecheck`; `npm test` (83 passed); `npm run test:llm` (5 passed against local Ollama).
