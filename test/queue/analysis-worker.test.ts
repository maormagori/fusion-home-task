import { beforeEach, describe, expect, it } from 'vitest';
import { feedbackStatusSchema } from '../../src/domain/types.js';
import { createOpenAiLlmClient } from '../../src/analysis/llm-client.js';
import { IN_MEMORY_PATH, openDatabase } from '../../src/db/database.js';
import { createFeedbackRepository, type FeedbackRepository } from '../../src/feedback/feedback.repository.js';
import { createLogger } from '../../src/logger.js';
import { processFeedback } from '../../src/queue/analysis-worker.js';
import { createUnreachableLlmTestConfig } from '../helpers/test-config.js';

const MAX_ATTEMPTS = 3;
const unreachableLlm = createOpenAiLlmClient(createUnreachableLlmTestConfig());
const logger = createLogger('silent');

let repo: FeedbackRepository;

beforeEach(() => {
  repo = createFeedbackRepository(openDatabase(IN_MEMORY_PATH));
});

describe('processFeedback', () => {
  it('does nothing when the item is not RECEIVED', async () => {
    const feedbackId = repo.insertOrGetExisting('The app crashes.').feedback.id;
    repo.transition(feedbackId, feedbackStatusSchema.enum.RECEIVED, feedbackStatusSchema.enum.ANALYZING);

    await processFeedback(feedbackId, { repo, llm: unreachableLlm, maxAttempts: MAX_ATTEMPTS, logger });

    const detail = repo.getDetail(feedbackId);
    expect(detail?.status).toBe(feedbackStatusSchema.enum.ANALYZING);
    expect(detail?.attempts).toEqual([]);
  });

  it('records every failed LLM call and ends in FAILED with the latest error', async () => {
    const feedbackId = repo.insertOrGetExisting('The app crashes.').feedback.id;

    await processFeedback(feedbackId, { repo, llm: unreachableLlm, maxAttempts: MAX_ATTEMPTS, logger });

    const detail = repo.getDetail(feedbackId);
    expect(detail?.status).toBe(feedbackStatusSchema.enum.FAILED);
    expect(detail?.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2, 3]);
    for (const attempt of detail?.attempts ?? []) {
      expect(attempt.rawResponse).toBeNull();
      expect(attempt.result).toBeNull();
      expect(attempt.error).toBeTruthy();
    }
    expect(detail?.lastError).toBe(detail?.attempts[MAX_ATTEMPTS - 1]?.error);
  });

  it('moves the item to FAILED instead of rejecting when an unexpected error is thrown', async () => {
    const feedbackId = repo.insertOrGetExisting('The app crashes.').feedback.id;
    const repoThatCannotRecordAttempts: FeedbackRepository = {
      ...repo,
      recordAttempt: () => {
        throw new Error('disk full');
      },
    };

    await expect(processFeedback(feedbackId, {
      repo: repoThatCannotRecordAttempts, llm: unreachableLlm, maxAttempts: MAX_ATTEMPTS, logger,
    })).resolves.toBeUndefined();

    const feedback = repo.findById(feedbackId);
    expect(feedback?.status).toBe(feedbackStatusSchema.enum.FAILED);
    expect(feedback?.lastError).toBe('Unexpected error during analysis: disk full');
  });
});
