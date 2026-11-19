# CLAUDE.md — Feedback Insights Service

Home assignment (3-hour timebox). A Fastify + SQLite backend that accepts user feedback and
analyzes it asynchronously with an LLM into strict, validated JSON.

- **Architecture and flows:** `docs/ARCHITECTURE.md`. Read it before writing code.
- **Your task:** if you are a task worker, your brief is `docs/tasks/T<n>.md`. Do only what it says.
- **Original challenge:** summarized in `docs/ARCHITECTURE.md`. The PDF is not in the repo.

## How work is organized

A **manager** session holds the plan, writes one brief per task, and reviews each PR. The **owner** (a human) merges.
Each **task worker** runs in its own Orca worktree with a fresh context and:

1. Reads this file, `docs/ARCHITECTURE.md`, and its own brief. Nothing else is required.
2. Touches only the files its brief lists. If something outside that scope must change, stop and ask the manager.
3. Implements against the **contracts below**. Do not change a contract signature without asking the manager.
4. Writes tests for its module and makes sure `npm run typecheck` and `npm test` pass.
5. Follows **Code style** below. The manager rejects code that is correct but hard to read.
6. Writes `docs/ai-notes/T<n>.md` (format below), including the walkthrough section.
7. Commits on its own branch, pushes it, opens a PR into the integration branch, and waits for CI
   to be green (see **Git**). Fixes red CI itself. Does not merge — the owner merges.

## Commands

```bash
npm install
npm run dev          # tsx watch src/server.ts
npm run build        # tsc
npm run typecheck    # tsc --noEmit
npm test             # vitest run, excludes *.llm.test.ts (no Ollama needed)
npm run test:llm     # vitest run on *.llm.test.ts only (needs local Ollama running)
npm run db:generate  # drizzle-kit generate (after changing src/db/schema.ts)
```

Local LLM: Ollama at `http://localhost:11434/v1`, model `qwen2.5:7b-instruct`.

## Stack (fixed; do not swap libraries)

Node 24, TypeScript (ESM, `"type": "module"`, strict), Fastify + `fastify-type-provider-zod`,
`better-sqlite3` + `drizzle-orm` (+ `drizzle-kit`), `openai` SDK (pointed at Ollama),
`zod` v4, `p-queue`, `vitest`, `tsx`.

## Layout

```
src/
  config.ts                     loadConfig(): Config (Zod-validated env)
  domain/types.ts               shared types (below)
  db/schema.ts                  Drizzle tables
  db/database.ts                openDatabase(path) → runs migrations from ./drizzle
  feedback/content-hash.ts      normalizeContent(), hashContent()
  feedback/feedback.repository.ts
  analysis/analysis.schema.ts   Zod schema for LLM output + AnalysisResult type
  analysis/prompt.ts            system prompt, buildInitialMessages, buildCorrectionMessages
  analysis/llm-client.ts        LlmClient interface + createOpenAiLlmClient
  analysis/analyzer.ts          validateRawOutput, analyzeOnce
  queue/analysis-queue.ts       createAnalysisQueue (p-queue)
  queue/analysis-worker.ts      processFeedback (retry + correction loop)
  api/feedback.schemas.ts       Zod request + response schemas (the API contract; no server imports, UI-importable)
  api/feedback.routes.ts
  api/app.ts                    buildApp(deps)
  server.ts                     wiring, startup recovery, listen
drizzle/                        generated migrations (committed)
test/                           mirrors src/, e.g. test/feedback/feedback.repository.test.ts
```

## Contracts

These are the agreed interfaces between modules. T1 creates the types; later tasks implement them.

```ts
// domain/types.ts
export const FEEDBACK_STATUSES = ['RECEIVED', 'ANALYZING', 'DONE', 'FAILED'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface Feedback {
  id: string;                 // uuid
  content: string;
  contentHash: string;
  status: FeedbackStatus;
  lastError: string | null;
  createdAt: string;          // ISO 8601
  updatedAt: string;
}

export interface AnalysisAttempt {
  id: number;
  feedbackId: string;
  attemptNumber: number;      // 1, 2, 3… across the item's whole lifetime
  rawResponse: string | null; // null only when the LLM call itself failed
  result: AnalysisResult | null; // set only when validation passed
  error: string | null;
  createdAt: string;
}

export interface FeedbackView extends Feedback {
  attemptCount: number;
  analysis: AnalysisResult | null; // non-null only when status === 'DONE'
}

export interface FeedbackDetail extends FeedbackView {
  attempts: AnalysisAttempt[];     // ordered by attemptNumber
}
```

```ts
// analysis/analysis.schema.ts
export const analysisResultSchema = z.strictObject({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  feature_requests: z.array(z.strictObject({
    title: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })),
  actionable_insight: z.string().min(1),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
```

```ts
// feedback/feedback.repository.ts   (synchronous: better-sqlite3 is sync)
export interface FeedbackRepository {
  insertOrGetExisting(content: string): { feedback: Feedback; created: boolean };
  // UPDATE … WHERE id = :id AND status = :from. Returns false if no row changed.
  transition(id: string, from: FeedbackStatus, to: FeedbackStatus,
             fields?: { lastError?: string | null }): boolean;
  findById(id: string): Feedback | null;
  getDetail(id: string): FeedbackDetail | null;
  list(params: { status?: FeedbackStatus; limit: number; offset: number }): FeedbackView[];
  recordAttempt(input: { feedbackId: string; rawResponse: string | null;
                         result: AnalysisResult | null; error: string | null }): AnalysisAttempt;
  resetInterruptedAnalyses(): number;          // ANALYZING → RECEIVED, returns count
  listIdsByStatus(status: FeedbackStatus): string[];
}
export function createFeedbackRepository(db: Database): FeedbackRepository;
```

```ts
// analysis/llm-client.ts
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export interface LlmClient { complete(messages: ChatMessage[]): Promise<string>; }
export function createOpenAiLlmClient(config: Config): LlmClient;

// analysis/prompt.ts
export function buildInitialMessages(content: string): ChatMessage[];
export function buildCorrectionMessages(raw: string, error: string): ChatMessage[]; // [assistant, user]

// analysis/analyzer.ts
export type AttemptOutcome =
  | { kind: 'success'; raw: string; result: AnalysisResult }
  | { kind: 'invalid_output'; raw: string; error: string }
  | { kind: 'llm_error'; error: string };
export function validateRawOutput(raw: string):
  { ok: true; result: AnalysisResult } | { ok: false; error: string };
export function analyzeOnce(llm: LlmClient, messages: ChatMessage[]): Promise<AttemptOutcome>;
```

```ts
// queue/analysis-queue.ts
export interface AnalysisQueue { enqueue(feedbackId: string): void; onIdle(): Promise<void>; }
export function createAnalysisQueue(concurrency: number,
  process: (feedbackId: string) => Promise<void>): AnalysisQueue;

// queue/analysis-worker.ts
export function processFeedback(feedbackId: string,
  deps: { repo: FeedbackRepository; llm: LlmClient; maxAttempts: number }): Promise<void>;

// api/app.ts
export function buildApp(deps: { repo: FeedbackRepository; enqueue: (id: string) => void;
                                  maxContentLength: number }): FastifyInstance;
```

## State rules (do not break these)

- Status changes **only** through `repo.transition()`. No other code writes `feedback.status`.
- Allowed transitions: `RECEIVED→ANALYZING`, `ANALYZING→DONE`, `ANALYZING→FAILED`,
  `FAILED→RECEIVED` (manual retry), `ANALYZING→RECEIVED` (startup recovery only).
- The worker must win `RECEIVED→ANALYZING` before calling the LLM. If it loses, it returns without doing anything.
- Every LLM call produces exactly one `analysis_attempts` row, valid or not.
- `ANALYZING→DONE` sets `lastError` to null. `ANALYZING→FAILED` sets `lastError` to the latest error.
- FAILED is the DLQ. Nothing leaves FAILED except `POST /feedback/:id/retry`.

## Code style — readability is a requirement, not a nice-to-have

The owner must be able to read and explain every file in a review interview. Write code for a reader
who knows TypeScript but has never seen this project. When in doubt, choose the boring, obvious version.

**Structure**
- One responsibility per file. Aim for files under ~150 lines and functions under ~30 lines.
- Read top-down: exported/main function first, private helpers below it.
- Factory functions returning plain objects (`createX(deps)`); no classes, no DI framework, no barrel `index.ts` files.
- Pass dependencies in as arguments. No module-level singletons except in `server.ts`.
- Named exports only. Explicit return types on exported functions.
- Don't add an abstraction (helper, generic, wrapper) that has only one caller unless it makes the caller clearly easier to read.

**Naming**
- Names say what the thing *is* in domain terms: `feedbackId`, `rawResponse`, `attemptNumber` — not `data`, `res`, `obj`, `tmp`, `x`.
- Functions are verbs (`recordAttempt`, `buildCorrectionMessages`); booleans read as questions (`wasClaimed`, `isDuplicate`).
- Use the same word for the same concept everywhere (status names, "attempt", "feedback"); match the names in the contracts.

**Control flow**
- Early returns over nested `if`/`else`. Max ~2 levels of nesting.
- Plain `for` loops and `if` statements over clever `reduce` chains or ternary stacks.
- Use discriminated unions + `switch` on `kind` for outcomes (see `AttemptOutcome`), so every case is visible.
- No magic numbers or strings: they come from `config` or a named constant.

**TypeScript**
- No `any`, no `as` casts except at a parsing boundary with a comment. No non-null `!` assertions.
- Prefer simple types and interfaces; avoid advanced generics, conditional or mapped types.
- Let Zod infer types instead of writing the same shape twice.

**Comments**
- **Add code comments only when necessary.** Clear names and small functions should explain the code on their own.
- A comment is necessary only when the *why* can't be read from the code: a non-obvious decision or constraint
  (e.g. why a conditional UPDATE, why we don't repair JSON). Never comment *what* the code does.
- No file-header comments, no comments restating a function or variable name, no JSDoc on obvious functions.
- No commented-out code, no TODOs without a note in your ai-notes.

**Errors**
- `try/catch` only where an error is turned into a value (`analyzeOnce`, the worker loop, the queue's job wrapper). Elsewhere let errors throw.
- Error messages say what failed and with which id/value.
- **No defensive programming beyond the spec.** If you want to add a guard the spec doesn't require,
  write the reason in your ai-notes and ask the manager first.

**Wording**
- Never use these words in comments, docstrings, or commit messages: consolidate, modernize, streamline,
  flexible, delve, establish, enhanced, comprehensive, optimize.

Before committing, re-read your diff as a reviewer and simplify anything you had to think twice about.

## Testing

- Vitest. DB tests use `openDatabase(':memory:')`, which runs the real migrations.
- **No fake LLM client.** Logic that doesn't need the model (validation, message building, queue concurrency)
  is unit-tested with plain inputs. Anything that calls the model goes in `*.llm.test.ts` and hits real Ollama.
- Test behavior that matters (state transitions, dedup, validation edge cases), not every line.

## Git

- Integration branch: `home-task-orchestration-plan`. One branch per task: `task/T<n>-<short-name>`, created from it.
- Small, focused commits with plain imperative messages.
- **Never** add `Co-Authored-By`, "Generated with Claude Code", or any AI attribution to commits or PRs.
- When done:
  ```bash
  git fetch origin && git rebase origin/home-task-orchestration-plan   # pick up merged tasks first
  npm run typecheck && npm test
  git push -u origin task/T<n>-<short-name>
  gh pr create --base home-task-orchestration-plan --title "T<n>: <title>" --body-file <file>   # body format below
  gh pr checks --watch                                                  # CI must be green
  ```
- CI (`.github/workflows/ci.yml`) runs typecheck + `npm test` on the PR merged with its base, so it checks that your
  task works **together with** everything already merged. LLM tests are not in CI; run `npm run test:llm` locally.
- Do not merge your PR. The manager reviews it; the owner merges it.
- The PR description **starts with a TL;DR** so the owner can follow it without reading your brief:
  ```markdown
  ## TL;DR
  **Asked to solve:** 1–2 plain sentences: what the task had to deliver and why it matters in the system.
  **How I went about it:** 3–5 bullets: the approach and key design choices, naming the files.
  **Decisions / tradeoffs:** anything the brief did not decide, or anything a reviewer might question.
  **How to verify:** the exact commands or tests that prove it works.
  ```
  Then the rest of the description (what changed, test results).

## AI notes (input for the README's AI Collaboration Log)

Each task writes `docs/ai-notes/T<n>.md`:

```markdown
# T<n> — <title>
Agent / model: <e.g. Claude Code, Opus 5.5 | Codex, gpt-6.1-sol medium>
## Prompts that mattered
- "<prompt text>" → what it produced
## Where the AI was wrong / low quality and how it was corrected
- <what it did> → <why it was wrong> → <the correction or constraint>
## Shortcuts / tradeoffs taken
- ...
## Walkthrough for the owner
- `<file>` — what it does in 1–2 sentences, and the one thing worth knowing when reading it.
- How to see it work: the test or command to run.
```

Be concrete and honest. This log is graded as seriously as the code.
