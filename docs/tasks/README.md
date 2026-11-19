# Task plan

Integration branch: `home-task-orchestration-plan`. Each task runs as a separate Orca worker on
its own branch `task/T<n>-<name>`; the manager reviews and merges into the integration branch.

```mermaid
flowchart LR
    T1[T1 Scaffold + contracts] --> T2[T2 Repository]
    T1 --> T3[T3 Analysis / LLM]
    T2 --> T4[T4 HTTP API]
    T2 --> T5[T5 Queue + worker + server]
    T3 --> T5
    T4 --> T6[T6 End-to-end + fixes]
    T5 --> T6
    T6 --> T7[T7 README + AI log]
```

| Task | Brief | Depends on | Est. |
|---|---|---|---|
| T1 | [Scaffold + contracts](T1-scaffold.md) | — | 25m |
| T2 | [Feedback repository](T2-repository.md) | T1 | 30m |
| T3 | [Analysis / LLM](T3-analysis.md) | T1 | 35m |
| T4 | [HTTP API](T4-api.md) | T2 | 25m |
| T5 | [Queue, worker, server](T5-queue-worker.md) | T2, T3 | 35m |
| T6 | [End-to-end + fixes](T6-e2e.md) | T4, T5 | 25m |
| T7 | [README + AI Collaboration Log](T7-readme.md) | T6 | 20m (manager + owner) |

Every worker: read `CLAUDE.md`, `docs/ARCHITECTURE.md`, and your brief. Stay inside your file list.
Done means: `npm run typecheck` and `npm test` pass locally (plus `npm run test:llm` where the brief says so),
`docs/ai-notes/T<n>.md` is written, and a PR into the integration branch has **green CI**.

## Integration gates

| Level | Where | What it proves |
|---|---|---|
| Module tests with real SQLite | each task's tests | the module works against the real schema and migrations |
| CI on the PR | GitHub Actions, run by the worker via `gh pr checks --watch` | the task works merged with everything already on the integration branch |
| LLM tests | locally, `npm run test:llm` (never in CI: no Ollama on runners) | prompts and schema work with the real model |
| End-to-end | T6 | the whole flow, including failure → DLQ → retry and restart recovery |

The manager merges only green PRs, and runs `npm run test:llm` on the integration branch after merging T3, T5, and T6.
"Done when … committed on `task/…`" in a brief also means the PR above is open and green.
