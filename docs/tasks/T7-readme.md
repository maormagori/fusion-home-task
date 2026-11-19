# T7 — README + AI Collaboration Log (manager + owner)

**When:** last, after T8 (UI) is merged, so the README describes the finished project.

**Goal:** the submission documents. Written by the manager with the owner, not by a fresh worker,
because it needs the full story of the session.

## Files
`README.md`, optionally `docs/AI_COLLABORATION_LOG.md` (linked from README).

## README contents
1. What it is (2–3 lines).
2. **Setup:** Node 24, Ollama + `ollama pull qwen2.5:7b-instruct`, `npm install`, `cp .env.example .env`, `npm run dev`;
   switching to OpenAI (3 env vars); running tests (`npm test`, `npm run test:llm`).
3. **API** with curl examples (from `scripts/smoke.sh`), and how to run the UI (`npm run web:dev` / `web:build`) with a screenshot from `docs/screenshots/`.
4. **Design decisions and tradeoffs**: short summary linking to `docs/ARCHITECTURE.md` — state machine with conditional
   transitions, FAILED as DLQ, two kinds of retry (transport vs correction), why dedup, concurrency in one place,
   OpenAI-compatible client, what was left out and why.

## AI Collaboration Log (graded as seriously as the code)
- **Tools:** Claude Code (Opus) as manager/orchestrator; Orca workers (Claude Code) per task.
- **Workflow:** manager + one fresh worker per task, contract-first (`CLAUDE.md`), briefs in `docs/tasks/`.
- **2–3 prompts** relied on (pick from the planning session and `docs/ai-notes/`).
- **Where the AI was wrong and how it was corrected** — at least one concrete example with before/after. Candidates
  already from planning: the AI first proposed a fake LLM client and no libraries at all ("no ORM, no queue library");
  the owner pushed back, and the result was the OpenAI-compatible SDK (transport retries for free plus a provider switch
  by config) and p-queue/Drizzle. Add the best example found by the task workers.
- **What I'd improve with more time:** adaptive concurrency on 429s, persistent queue (e.g. BullMQ/Redis) for
  multi-instance, near-duplicate detection, metrics on correction-path frequency, a recorded-response test client for
  deterministic CI.
