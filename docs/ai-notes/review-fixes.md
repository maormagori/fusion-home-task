Agent / model: Codex, GPT-6

# Review fixes

## Prompts that mattered
- Review every finding before coding and ask for owner approval → proposed fixes and documented tradeoffs through the coordinator.
- Owner: about one hour remains; fix 3, 4 and X1; defer query changes → limited the patch to provider failure classification, blank-output validation and receiver-independent completion.
- Test provider errors with the real SDK against a local scripted HTTP server → deterministic coverage without a fake LlmClient or changes to the e2e worker's files.

## Where the AI was wrong / low quality and how it was corrected
- Initially put OpenAI status handling in the analyzer → coordinator found that provider details escaped the client → moved classification into the client, exported LlmCallError and made the analyzer read its retryable field.
- Initially proposed the query/index change → owner judged the scale and remaining time did not justify it → left queries and migrations unchanged and recorded DOCUMENT in section C.
- Initially added a schema-only assertion that the raw input string stayed unchanged → it did not verify persistence → removed the assertion; the HTTP-server worker test checks the exact persisted blank raw output.

## Shortcuts / tradeoffs taken
- Permanent HTTP errors stop after their failed application call is persisted. Connection failures, missing-content errors, HTTP 408/409/429 and 5xx remain retryable within the existing budget; SDK retries remain unchanged.
- Scripted-server tests disable SDK retries to count application attempts directly; real Ollama tests still verify model compatibility.
- The test fixture checks server.address() only to narrow Node's TCP/pipe/null union before constructing the test URL; no new production guards were added.
- Left finding 1, correction-loop e2e coverage and broader tradeoff/rule discussion to their assigned owners.

## Walkthrough for the owner
- `src/analysis/analysis.schema.ts` — trims titles and insights before checking their length; whitespace-only model output now receives correction instead of DONE.
- `src/analysis/llm-client.ts` — translates SDK failures to LlmCallError and owns provider-specific retry classification. `src/analysis/analyzer.ts` and `src/queue/analysis-worker.ts` read that classification, persist the failure and stop permanent errors immediately. Correction history survives transient errors.
- `src/feedback/feedback.repository.ts` — calls named inner functions during atomic completion; destructuring the public method now works.
- `test/queue/provider-errors.test.ts` — local HTTP server plus real SDK checks permanent errors, transient exhaustion and blank output → transient error → success with unchanged correction history and exact stored attempts.
- `test/analysis/analysis.schema.test.ts` and `test/feedback/feedback.repository.test.ts` — cover blank fields, trimming, JSON-schema conversion and destructured completion, including rejected completion.
- `CLAUDE.md` — updates the approved schema and outcome contracts. `docs/TRADEOFFS.md` section C records only the requested decisions.
- How to see it work: `npm run typecheck`, `npm test`, `npm run test:llm` (requires local Ollama). After integration rebase and npm ci: typecheck passed, 107 regular tests passed across 14 files, and 5 real-model tests passed across 3 files. The initial post-rebase checks failed because the newly merged UI dependency was absent locally; npm ci installed it before the passing rerun.
