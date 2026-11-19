# AI Collaboration Log

Every task also has its own detailed notes in [`docs/ai-notes/`](ai-notes/): prompts used, where the AI was wrong,
shortcuts taken, and a walkthrough of the files it wrote.

## Tools and workflow

**Tools:** Claude Code (Opus 5.5), Codex (gpt-6.1-sol, medium effort), and Orca, which ran them as parallel agents,
each in its own git worktree.

**Orchestrator + workers.** One long-running Claude Code session acted as the **orchestrator**. It never wrote
feature code:
- It planned the work with me and wrote the rules every agent follows: [`CLAUDE.md`](../CLAUDE.md) (contracts between
  modules, state rules, code style) and [`docs/ARCHITECTURE.md`](ARCHITECTURE.md).
- It split the work into small tasks and started one **fresh worker per task** through Orca. A worker sees only the
  rules and its own brief, so its context stays small and focused.
- It reviewed every PR and sent problems back to the worker that wrote it. I reviewed and merged every PR.

**Task management in [`docs/tasks/`](tasks/).** Each task has a brief (`T<n>-*.md`): goal, files it may touch,
contracts it must follow, and when it's done. [`docs/tasks/README.md`](tasks/README.md) holds the task order and
dependencies, so tasks without dependencies ran in parallel.

**Each worker's loop:** read the brief, implement against the contracts, write tests, open a PR with a TL;DR, wait for
green CI, and write its notes in `docs/ai-notes/`.

**Two agents, on purpose.** Claude Code built most features (scaffold, repository, API, queue and worker, UI).
Codex did refactors, bug fixes, the failure-path test suite, and an **independent code review**: a different model
from the one that wrote the code, told not to read the authors' notes.

## Prompts I relied on

1. **The kickoff:** asking the AI to act as my orchestrator, confirm I understood the task, and route every
   assumption through me, with a plan split into modular, testable tasks and code I can read and explain.
   This produced the contract-first `CLAUDE.md` that let workers build in parallel.
2. **Pushing back on minimalism:** asking for the real model in tests instead of a fake client, and for libraries
   that remove infrastructure work. This changed the stack (see below).
3. **Asking for failure-path tests:** asking for tests beyond the happy path, so anything important gets flagged.
   Planning those tests found two real bugs.

## Where the AI was wrong, and how it was corrected

**The main example: a fake LLM and no libraries.** The first plan used a fake LLM client in tests, a hand-written
queue, and raw SQL. A fake client only tests our own assumptions about the model, and hand-written infrastructure is
code to maintain for no benefit. I constrained it to the real model and standard libraries. The result: the `openai`
SDK pointed at Ollama (retries, timeouts and switching providers come with it), plus `p-queue` and Drizzle. A scripted
HTTP server is used only for failures a real model won't produce on demand.

Other corrections, in short:
- **A real bug behind a query I questioned:** the analysis was picked with `MAX()` over JSON text, which could return
  an older result after a crash. It's fixed with one transaction and "latest valid attempt".
- **An abstraction leak:** a fix put OpenAI-specific error checks in the analyzer. It was moved back into the LLM client.
- **Code that worked but was hard to read:** header comments, `console.log`, and hard-coded strings. Each became a
  rule in `CLAUDE.md`.

## What I'd improve

- **Give workers a ready lockfile recipe from the start.** The same CI failure (an incremental `npm install` on macOS
  dropping packages Linux needs) cost time in three separate tasks.
- **Review continuously, not once.** The independent review ran in parallel with the UI and refactors, so some of its
  findings landed after the code they touched had moved. A short review by a different model after every few tasks
  would have caught issues like the abstraction leak earlier.
