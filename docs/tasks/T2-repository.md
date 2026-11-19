# T2 — Feedback repository

**Goal:** implement `FeedbackRepository` (contract in `CLAUDE.md`) on Drizzle + SQLite. This is the only module that
reads or writes the database, and `transition()` is how the state machine is enforced.

## Files you own
`src/feedback/content-hash.ts`, `src/feedback/feedback.repository.ts`,
`test/feedback/content-hash.test.ts`, `test/feedback/feedback.repository.test.ts`.

## Behavior
- `normalizeContent(s)`: trim, collapse all whitespace runs to one space, lowercase.
  `hashContent(s)`: SHA-256 hex of the normalized content (`node:crypto`).
- `insertOrGetExisting(content)`: insert with `crypto.randomUUID()`, status `RECEIVED`, `created_at = updated_at = now`,
  using `onConflictDoNothing({ target: content_hash })`. Then select by hash. `created` is true only if this call inserted.
  Store the **original** content, not the normalized one.
- `transition(id, from, to, fields)`: single `UPDATE … WHERE id = ? AND status = ?`, sets `status`, `updated_at`, and
  `last_error` when `fields.lastError` is provided (including `null`). Returns `changes === 1`.
  Do not validate which transitions are allowed here; callers follow the rules in `CLAUDE.md`.
- `recordAttempt(input)`: in one transaction, `attempt_number = (max for this feedback) + 1`, insert, return the row.
  Store `result` as `JSON.stringify`, read it back with `JSON.parse` (it was validated before being stored).
  Recording an attempt also bumps the feedback's `updated_at`.
- `findById`, `getDetail` (feedback + attempts ordered by `attempt_number`), `list` (newest first, optional status
  filter, limit/offset). `attemptCount` = number of attempts. `analysis` = the attempt's result where
  `result_json IS NOT NULL`, only when status is `DONE`, otherwise `null`. Avoid N+1 queries in `list`.
- `resetInterruptedAnalyses()`: `ANALYZING → RECEIVED` for all rows, returns count.
- `listIdsByStatus(status)`: ids ordered oldest first.
- Map DB rows to the domain types in one small `toFeedback` / `toAttempt` helper each.

## Tests (in-memory DB via `openDatabase(':memory:')`)
- Normalization: `"  Add  Dark Mode "` and `"add dark mode"` hash the same; different text differs.
- Dedup: second insert of normalized-equal content returns the same id with `created: false`.
- `transition`: succeeds from the right status; returns false from the wrong one and leaves the row unchanged; sets/clears `lastError`.
- `recordAttempt`: numbers 1, 2, 3 per feedback, independent between feedbacks.
- `list`: status filter, pagination, `analysis` null unless DONE, `attemptCount` correct.
- `resetInterruptedAnalyses` and `listIdsByStatus`.

## Done when
typecheck + tests pass; `docs/ai-notes/T2.md`; committed on `task/T2-repository`.
