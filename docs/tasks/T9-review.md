# T9 — Independent code review (read-only)

**When:** after T6 is merged (backend proven), in parallel with T8.

**Goal:** an objective review by an agent that did not take part in building or planning this code. Find real
problems: bugs, inconsistent state, inefficiencies, and weak architecture. **Challenge the design**, not just
whether the code follows it. You change no code; you write a report.

## Inputs (read these, and only these, before forming opinions)
- The challenge requirements (summary below).
- `docs/ARCHITECTURE.md`: what we intended. Treat it as a claim to verify, not as truth.
- `CLAUDE.md`: the project's code rules (check the code against them, but you may also argue a rule is wrong).
- All code under `src/`, `test/`, `drizzle/`, `scripts/`, plus `package.json` and `.github/workflows/`.
- Do **not** read `docs/ai-notes/`, `docs/tasks/`, or PR descriptions; they contain the authors' justifications.

### Challenge requirements (summary)
Backend that accepts free-text feedback, persists it (SQLite/Postgres) with id, content, status
(RECEIVED | ANALYZING | DONE | FAILED), created_at, updated_at. Submission must not block on analysis; analysis runs
asynchronously (in-process queue acceptable); state flow RECEIVED → ANALYZING → DONE | FAILED; failures explicit and
retriable. LLM must return strict JSON `{sentiment: positive|neutral|negative, feature_requests: [{title, confidence}],
actionable_insight}`; validate it, mark FAILED if invalid, persist both raw response and validated result. One
guardrail (dedup, rate limit, cache, or truncation). Read API listing feedback with status and analysis.
Graded on: engineering judgment, correctness, data and state consistency, quality of AI integration (validation,
failures, retries), clarity of tradeoffs. Not graded: UI polish, auth, deployment, full test coverage.

## What to look for
1. **Correctness:** wrong behavior, race conditions (concurrent jobs, double retry, recovery + enqueue), error paths.
2. **State and data consistency:** can any sequence leave an item in a wrong or stuck state, or attempts out of sync with status?
3. **AI integration:** validation gaps, retry/correction logic, prompt-injection exposure, timeouts, what gets persisted.
4. **Inefficiencies:** unnecessary queries, N+1, work repeated per call that could be done once, blocking calls on the event loop.
5. **Architecture:** module boundaries, dependency direction, coupling, things that will hurt when switching to OpenAI,
   adding a UI, or running more than one instance.
6. **Tests:** important behavior that is untested, or tests that pass for the wrong reason.
7. **Rule violations** from `CLAUDE.md` (only notable ones; don't list style nits one by one).

## Output
`docs/reviews/code-review.md`:
- **Summary:** 3–5 lines, your overall verdict.
- **Findings**, most severe first, each with: severity (`high` | `medium` | `low`), category, `file:line`, the problem,
  a **concrete failure scenario** (inputs/sequence → wrong result), suggested fix, effort (S/M/L).
  Only report what you verified by reading the code (or running it); mark anything uncertain as "unverified".
- **Tradeoff assessment:** for each tradeoff in `docs/ARCHITECTURE.md` §6, §8, §9 (concurrency, in-process queue,
  FAILED as DLQ, dedup normalization, rejection instead of truncation, no JSON repair, transport vs correction retries,
  SQLite), say whether you agree, and what you would do differently and why.
- **What is good:** a few lines, so the owner knows what not to change.

You may run `npm install`, `npm run typecheck`, `npm test`, `npm run test:llm`, and the app (Ollama at
http://localhost:11434, qwen2.5:7b-instruct) to confirm a finding. Do not change any file except the report.

## Done when
Branch `task/T9-review`, one commit adding the report, PR into `home-task-orchestration-plan` with the TL;DR
(its "How I went about it" says what you read and ran). Report with worker_done: the counts per severity and the top 3 findings.
