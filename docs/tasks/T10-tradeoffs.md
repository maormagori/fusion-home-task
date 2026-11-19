# T10 — Tradeoff session + review fixes (manager + owner)

**When:** after T9's report is in (T8 may still be running).

## Steps
1. Manager prepares `docs/TRADEOFFS.md`: one short entry per tradeoff taken (what we chose, alternatives, cost,
   when we would revisit it). Includes at least: concurrency (fixed per process via env, adaptive later), in-process
   queue, FAILED as DLQ, dedup normalization and returning FAILED duplicates, max length rejection, no JSON repair,
   transport retries (SDK) vs correction retries (loop), SQLite, OpenAI-compatible client against Ollama, no fake LLM
   in tests (scripted LLM server only for behavior the real model won't produce), LLM tests outside CI,
   Fastify body limit not derived from MAX_CONTENT_LENGTH (P03: owner chose document-only), crash recovery may repeat
   LLM work (at-least-once, not exactly-once).
2. Owner and manager go through `docs/TRADEOFFS.md` next to `docs/reviews/code-review.md`. For each tradeoff and each
   finding, decide: **fix now**, **document as known tradeoff**, or **reject** (with a reason).
3. "Fix now" items go to workers (Codex where possible) as small PRs, following the normal flow (TL;DR, green CI, owner merges).
4. Decisions are recorded in `docs/TRADEOFFS.md` and become the README's "Design decisions and tradeoffs" section in T7.
