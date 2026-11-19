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
npm run web:dev      # Vite dev server for web/, proxies /feedback and /config to :3000
npm run web:build    # builds web/dist; npm run dev then serves it at /
npm run web:typecheck
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
  logger.ts                     createLogger(level): Logger (the only logger; pino)
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
  queue/recovery.ts             recoverPendingAnalyses (startup reset + enqueue)
  api/feedback.schemas.ts       Zod request + response schemas (the API contract; no server imports, UI-importable)
  api/feedback.routes.ts
  api/app.ts                    buildApp(deps); serves UI_DIST_PATH at / when the folder exists
  server.ts                     wiring, startup recovery, listen
drizzle/                        generated migrations (committed)
web/                            UI npm workspace (Vite + React): own package.json, tsconfig, vite.config.ts
  src/models.ts                 the only file in web/ that imports backend models (schemas, types, paths)
  src/api.ts                    one fetch function per endpoint, responses parsed with the backend schemas
test/                           mirrors src/, e.g. test/feedback/feedback.repository.test.ts
```

## Contracts

These are the agreed interfaces between modules. T1 creates the types; later tasks implement them.

```ts
// domain/types.ts — model fields defined once in Zod
export const FEEDBACK_STATUSES = ['RECEIVED', 'ANALYZING', 'DONE', 'FAILED'] as const;
export const feedbackStatusSchema = z.enum(FEEDBACK_STATUSES);
export const feedbackSchema = z.object({
  id: z.string(), content: z.string(), contentHash: z.string(), status: feedbackStatusSchema,
  lastError: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
});
export const analysisAttemptSchema = z.object({
  id: z.number().int(), feedbackId: z.string(), attemptNumber: z.number().int(),
  rawResponse: z.string().nullable(), result: analysisResultSchema.nullable(),
  error: z.string().nullable(), createdAt: z.string(),
});
export const feedbackViewSchema = feedbackSchema.extend({
  attemptCount: z.number().int(), analysis: analysisResultSchema.nullable(),
});
export const feedbackDetailSchema = feedbackViewSchema.extend({ attempts: z.array(analysisAttemptSchema) });
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;
export type AnalysisAttempt = z.infer<typeof analysisAttemptSchema>;
export type FeedbackView = z.infer<typeof feedbackViewSchema>;
export type FeedbackDetail = z.infer<typeof feedbackDetailSchema>;

// Field meaning (not expressible in the schema):
// id: uuid · createdAt/updatedAt: ISO 8601
// attemptNumber: 1, 2, 3… across the item's whole lifetime (keeps counting after a manual retry)
// rawResponse: null only when the LLM call itself failed · result: set only when validation passed
// analysis: non-null only when status === 'DONE' · attempts: ordered by attemptNumber
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
  completeAnalysis(input: { feedbackId: string; rawResponse: string; result: AnalysisResult }):
    { attempt: AnalysisAttempt; completed: true } | { attempt: null; completed: false };
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
// logger.ts — one pino logger, created once in server.ts and passed down as a dependency
export type Logger = pino.Logger;
export function createLogger(level: Config['LOG_LEVEL']): Logger;   // tests use createLogger('silent')

// queue/analysis-queue.ts
export interface AnalysisQueue { enqueue(feedbackId: string): void; onIdle(): Promise<void>; }
export function createAnalysisQueue(concurrency: number,
  process: (feedbackId: string) => Promise<void>, logger: Logger): AnalysisQueue;

// queue/analysis-worker.ts — never rejects: unexpected errors end the item in FAILED
export function processFeedback(feedbackId: string,
  deps: { repo: FeedbackRepository; llm: LlmClient; maxAttempts: number; logger: Logger }): Promise<void>;

export function recoverPendingAnalyses(repo: FeedbackRepository, queue: AnalysisQueue, logger: Logger): { interruptedCount: number; enqueuedCount: number }; // queue/recovery.ts
// api/app.ts — Fastify uses the same logger (`loggerInstance`), so request logs and app logs share format and level
export function buildApp(deps: { repo: FeedbackRepository; enqueue: (id: string) => void;
                                  maxContentLength: number; logger: Logger; uiDistPath?: string }): FastifyInstance;
```

## State rules (do not break these)

- Status changes go through repository methods: `transition()`, `completeAnalysis()`, and startup recovery.
- Allowed transitions: `RECEIVED→ANALYZING`, `ANALYZING→DONE`, `ANALYZING→FAILED`,
  `FAILED→RECEIVED` (manual retry), `ANALYZING→RECEIVED` (startup recovery only).
- The worker must win `RECEIVED→ANALYZING` before calling the LLM. If it loses, it returns without doing anything.
- A successful attempt and DONE are written in one transaction. `completeAnalysis()` returns completed false
  and stores nothing when the item is not ANALYZING.
- Every LLM call produces exactly one `analysis_attempts` row, valid or not, except when successful
  completion is rejected because the item is no longer ANALYZING.
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
- web/ imports backend models only through web/src/models.ts.

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
- Models are defined once as Zod schemas; TypeScript types are `z.infer` of them. Never write an interface that repeats a schema.

**Comments**
- **Add code comments only when necessary.** Clear names and small functions should explain the code on their own.
- A comment is necessary only when the *why* can't be read from the code: a non-obvious decision or constraint
  (e.g. why a conditional UPDATE, why we don't repair JSON). Never comment *what* the code does.
- No file-header comments, no comments restating a function or variable name, no JSDoc on obvious functions.
- No commented-out code, no TODOs without a note in your ai-notes.

**No hard-coded strings when a source of truth exists**
- If a value is defined somewhere (a schema, a constant, config), import it. Never retype it as a string or number literal.
  - Statuses: `feedbackStatusSchema.enum.DONE`, not `'DONE'`. Lists of statuses: `FEEDBACK_STATUSES`.
  - Sentiments and other enum values: from their Zod schema (`analysisResultSchema.shape.sentiment.enum`).
  - Config values (URLs, limits, model names, ports): from `Config`, also in tests (use the test config helper).
  - HTTP status codes: named constants in one place, not bare `404`/`409` sprinkled through routes and tests.
  - Error messages the API returns: exported constants, so tests assert against the same constant.
  - Route paths used in more than one place: one constant.
- Fine as literals: log messages, one-off error text, test names, and discriminated-union tags inside a `switch`
  (the compiler already checks those against the type).
- When a value has no source of truth yet but is used in 2+ places, create one (a named constant or schema) instead
  of repeating the literal.

HTTP status codes: StatusCodes from http-status-codes. API paths: the constants and URL builders in src/api/feedback.schemas.ts.

**Logging**
- Use the injected `Logger` only. **No `console.*` anywhere** in `src/` (tests and scripts included unless printing is the point).
- Structured fields, short message: `logger.info({ feedbackId, attemptNumber }, 'Analysis attempt failed')`.
- Levels: `info` for state changes (claimed, DONE, FAILED, recovery), `warn` for a failed attempt that will be retried,
  `error` for unexpected errors. Never log full feedback content or raw LLM responses (they are in the DB).

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

### Addressing review comments

When the manager says the owner left comments on your PR:
1. Read all of them: inline review comments with `gh api repos/{owner}/{repo}/pulls/<n>/comments` and general ones
   with `gh pr view <n> --comments`.
2. For each comment, either fix it or, if you disagree, reply with a short reason. Never ignore one silently.
   If a comment asks for something outside your file list or changes a contract, ask the manager first.
3. Push the fixes to the same branch (new commits, no force-push), reply under each comment with what changed
   (`gh api …/pulls/<n>/comments/<id>/replies -f body=…` for inline comments, `gh pr comment <n>` for general ones),
   update the TL;DR if the approach changed, and wait for green CI.
4. Report with worker_done: one line per comment (fixed / replied, and how).

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
