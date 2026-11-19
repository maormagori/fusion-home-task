import { beforeEach, describe, expect, it } from 'vitest';
import { createOpenAiLlmClient } from '../../src/analysis/llm-client.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/database.js';
import { createFeedbackRepository, type FeedbackRepository } from '../../src/feedback/feedback.repository.js';
import { processFeedback } from '../../src/queue/analysis-worker.js';

const MAX_ATTEMPTS = 3;

// Port 9 (discard) has nothing listening, so every call fails fast with connection refused.
const unreachableLlm = createOpenAiLlmClient(
  loadConfig({ LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_SDK_MAX_RETRIES: '0' }),
);

let repo: FeedbackRepository;

beforeEach(() => {
  repo = createFeedbackRepository(openDatabase(':memory:'));
});

describe('processFeedback', () => {
  it('does nothing when the item is not RECEIVED', async () => {
    const feedbackId = repo.insertOrGetExisting('The app crashes.').feedback.id;
    repo.transition(feedbackId, 'RECEIVED', 'ANALYZING');

    await processFeedback(feedbackId, { repo, llm: unreachableLlm, maxAttempts: MAX_ATTEMPTS });

    const detail = repo.getDetail(feedbackId);
    expect(detail?.status).toBe('ANALYZING');
    expect(detail?.attempts).toEqual([]);
  });

  it('records every failed LLM call and ends in FAILED with the latest error', async () => {
    const feedbackId = repo.insertOrGetExisting('The app crashes.').feedback.id;

    await processFeedback(feedbackId, { repo, llm: unreachableLlm, maxAttempts: MAX_ATTEMPTS });

    const detail = repo.getDetail(feedbackId);
    expect(detail?.status).toBe('FAILED');
    expect(detail?.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2, 3]);
    for (const attempt of detail?.attempts ?? []) {
      expect(attempt.rawResponse).toBeNull();
      expect(attempt.result).toBeNull();
      expect(attempt.error).toBeTruthy();
    }
    expect(detail?.lastError).toBe(detail?.attempts[MAX_ATTEMPTS - 1]?.error);
  });
});
