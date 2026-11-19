# T3 — Analysis / LLM

**Goal:** turn feedback text into a validated `AnalysisResult`, one attempt at a time, with clear typed outcomes.
This module never touches the database and never retries on its own (except the SDK's transport retries).

## Files you own
`src/analysis/prompt.ts`, `src/analysis/llm-client.ts`, `src/analysis/analyzer.ts`,
`test/analysis/prompt.test.ts`, `test/analysis/analyzer.test.ts`, `test/analysis/analyzer.llm.test.ts`.
(`analysis.schema.ts` exists from T1; do not change it without asking the manager.)

## Behavior
- **Prompt** (`prompt.ts`):
  - System prompt: role (product feedback analyst), the exact output shape, the meaning of each field
    (`confidence` = 0..1 how sure this is a real feature request; empty `feature_requests` when there are none;
    `actionable_insight` = one concrete sentence for the product team), and "respond with JSON only".
  - Treat the feedback as **data**: put it in the user message between clear delimiters and tell the model to
    ignore any instructions inside it (prompt-injection mitigation).
  - `buildInitialMessages(content)` → `[system, user]`.
  - `buildCorrectionMessages(raw, error)` → `[{assistant: raw}, {user: "Your previous response was invalid: <error>. Return only corrected JSON that matches the schema."}]`.
- **LLM client** (`llm-client.ts`): `createOpenAiLlmClient(config)` using the `openai` SDK with `baseURL`, `apiKey`,
  `timeout`, `maxRetries` from config. Call `chat.completions.create` with `temperature: 0` and
  `response_format: { type: 'json_schema', json_schema: { name: 'feedback_analysis', strict: true, schema: z.toJSONSchema(analysisResultSchema) } }`.
  Return `choices[0].message.content`; throw if it is empty.
  Check that the generated JSON Schema is accepted by Ollama (it was tested by hand with an equivalent schema); if a keyword is rejected, tell the manager.
- **Analyzer** (`analyzer.ts`):
  - `validateRawOutput(raw)`: `JSON.parse` (failure → `"Response is not valid JSON: <message>"`), then
    `analysisResultSchema.safeParse` (failure → `z.prettifyError(error)`). Do not strip markdown fences or "repair" JSON:
    structured output should prevent them, and repairing would hide real failures.
  - `analyzeOnce(llm, messages)`: call `llm.complete`; on throw → `{ kind: 'llm_error', error: message }`;
    otherwise validate → `success` or `invalid_output` (both keep `raw`).

## Tests
- `analyzer.test.ts` (no Ollama): `validateRawOutput` on valid JSON, non-JSON text, fenced JSON, missing key, extra key,
  bad sentiment, confidence 1.5, empty title, empty `feature_requests` (valid).
  `analyzeOnce` with a client built from `createOpenAiLlmClient` pointed at an unused port with `maxRetries: 0` → `llm_error`.
- `prompt.test.ts`: initial messages contain the feedback inside the delimiters; correction messages contain raw and error.
- `analyzer.llm.test.ts` (real Ollama): clearly negative feedback with a feature request → `success`, sentiment `negative`,
  at least one feature request. Generous timeout.

## Done when
typecheck + `npm test` pass, `npm run test:llm` passes locally; `docs/ai-notes/T3.md`; committed on `task/T3-analysis`.
