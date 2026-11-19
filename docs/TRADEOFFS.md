# Tradeoffs and review decisions

Draft for the owner + manager session (T10). Each entry: what we chose, the alternatives, what it costs, when to
revisit, and the **decision** (fix now / document / reject).

## A. Tradeoffs taken during the build

| # | Topic | What we chose | Alternatives | Cost | Revisit when | Reviewer (T9) | Proposed decision |
|---|---|---|---|---|---|---|---|
| 1 | Concurrency | Async jobs in one Node process, limit fixed per process via `ANALYSIS_CONCURRENCY` (default 2) | Worker threads; adaptive concurrency (back off on 429s); per-provider limits | Doesn't react to provider pressure; with Ollama the real parallelism is `OLLAMA_NUM_PARALLEL` | Moving to OpenAI with rate limits | Agree. Call it a job limit, not a throughput guarantee; sync SQLite still blocks the event loop | **DOCUMENT (owner).** Configurable, not dynamic: `ANALYSIS_CONCURRENCY` is read at startup (raise it for GPT; match `OLLAMA_NUM_PARALLEL` for local Ollama). Not dynamic because a local model has no rate limits to react to, adaptive back-off adds timing logic that is hard to test in the timebox, and `p-queue` already lets the limit change at runtime when we need it. Adaptive concurrency on 429s is future work. |
| 2 | Queue | In-process `p-queue` + startup recovery (reset ANALYZING, re-enqueue RECEIVED) | BullMQ/Redis; DB-polling worker with leases | Single instance only. Recovery is at-least-once: a crash can repeat an LLM call. A second process would reset the first one's claims | More than one instance | Agree for the timebox; don't claim multi-instance safety | **DOCUMENT (owner), stated prominently.** **Single instance only:** a second process would reset the first one's in-flight claims and both could analyze the same item. **At-least-once:** feedback is persisted before it is queued and recovered on restart, so nothing is lost, but a crash after the model replied and before the result was saved repeats the LLM call. Proven by the real kill/restart test. Scaling out needs a durable queue (BullMQ/Redis) or DB polling with expiring claims: future work. |
| 3 | DLQ | FAILED status is the DLQ (`GET /feedback?status=FAILED`), leaves only via manual retry | Separate dead-letter table; DEAD status | No separate audit of DLQ entries; `lastError` keeps the previous run's error until the next success | Ops needs DLQ metrics | Agree; document that `lastError` persists during a retry | **DOCUMENT (owner).** FAILED + `lastError` + full attempt history is the DLQ; `GET /feedback?status=FAILED` lists it; only an explicit retry leaves it, with a fresh attempt budget and continuing attempt numbers. Known behavior: `lastError` keeps the previous run's error until the next success (each error also stays on its attempt row). No separate DLQ table or metrics. |
| 4 | Guardrail | Hash dedup: trim, collapse whitespace, lowercase, SHA-256, unique index | Rate limit; cache; truncation | Near-duplicates analyzed separately; merges case-sensitive text (code identifiers); loses submission counts; FAILED duplicate returned as FAILED | Product wants demand frequency or multi-user | Agree; suggests idempotency key + submission count later | **DOCUMENT (owner).** Goal: deduplicate identical requests (double clicks, client retries, the same text resent), not similar feedback. "Identical" ignores only case and whitespace differences, so `"Add dark mode "` and `"add  dark mode"` are one item. Not a goal: merging near-duplicates. Known costs: case-sensitive text that differs only by case is merged; submission counts are lost; a FAILED duplicate is returned as FAILED until retried. Enforced by a unique index, race-safe (12 concurrent identical submits → 1 row, 1 LLM run). Submission counts / idempotency keys: future work. |
| 5 | Long input | Reject over `MAX_CONTENT_LENGTH` (400) | Truncate (the 4th guardrail option) | Long feedback must be shortened by the client | — | Agree | Document |
| 6 | Body limit (P03) | Fastify's 1 MB body limit isn't derived from `MAX_CONTENT_LENGTH` | Set `bodyLimit` from config | Only matters if configured above ~250k chars | Large configured limits | Known, not counted | Document (owner chose) |
| 7 | JSON handling | Strict Zod validation, no repair (no fence stripping), raw always stored | Repair/strip fences; lenient parse | Some recoverable outputs need a correction round trip | — | Agree; delimiters are a mitigation, not a security boundary | Document |
| 8 | Retries | Two layers: SDK transport retries (backoff) inside one attempt; worker attempts with correction messages for invalid output | One retry loop for everything | With defaults up to 3 attempts × 3 HTTP requests; attempt rows count app attempts, not HTTP requests | — | Agree; see finding 3 for permanent errors | Document + finding 3 |
| 9 | Database | SQLite, synchronous `better-sqlite3`, WAL, Drizzle | Postgres; async driver | Sync queries block the event loop; single host | Load or multiple instances | Agree; fix finding 1 before switching DB | Document |
| 10 | LLM client | `openai` SDK against Ollama's OpenAI-compatible `/v1`, model `qwen2.5:7b-instruct` | Ollama SDK; provider-specific clients | OpenAI strict mode may reject some schema keywords (`minLength`, `minimum`) when switching providers | Switching to GPT | — | Document |
| 11 | Testing | Real model for normal flows; scripted OpenAI-compatible server only for behavior the real model won't produce; LLM tests run locally, not in CI | Fake `LlmClient` everywhere; Ollama in CI | LLM tests are slower and not in CI | — | Suggests a scripted client for the correction path (now covered by T6b's scripted server) | Document |
| 12 | Models | Zod schemas are the single source; TS types are `z.infer`; UI imports them | Hand-written interfaces + `satisfies` | — | — | Positive | — |

## B. Bugs found and fixed

| Id | Bug | Found by | Status |
|---|---|---|---|
| A05 | Empty model reply treated as a transport error (raw lost, no correction) | T6b plan | Fixed in PR #9 |
| S02 | Crash between saving a valid attempt and DONE could leave two valid results; `MAX(result_json)` could show the older one | T6b plan (the owner had questioned `MAX()` in T2 review) | Fixed in PR #9 (one transaction; latest valid attempt by number) |

## C. Independent review findings (T9)

| # | Severity | Finding | Proposed decision | Why |
|---|---|---|---|---|
| 1 | medium | List/detail aggregate the whole attempt history even for one item or `limit=1`; no index for the list order | **DOCUMENT:** deferred for assignment scale and time budget; shared-models work will touch this area | Cheap; reads are polled by the UI; scales with history otherwise |
| 2 | medium | No deterministic test of the correction loop through the worker | **Covered by T6b** (scripted server, A01–A04, T05) | Already in flight |
| 3 | low | Permanent provider errors (404 model, 401 key) burn all attempts | **FIX done:** permanent HTTP errors persist one failed call and stop; transient errors retain bounded retries | One-line config mistakes otherwise multiply calls; good AI-integration signal for graders |
| 4 | low | Whitespace-only `title` / `actionable_insight` pass validation | **FIX done:** `.trim().min(1)` rejects blank titles and insights; raw responses remain unchanged | One-line, closes a validation gap |
| X1 | low | `completeAnalysis` depends on `this`, so destructured calls fail | **FIX done:** call named inner `transition` / `recordAttempt` functions; transaction and rejected-claim behavior tested | Factory methods should work without a receiver |
| — | rule | "Status only via `transition()`" contradicted by bulk `resetInterruptedAnalyses` | **Document** the startup-recovery exception in CLAUDE.md | Rule wording, not a bug |
