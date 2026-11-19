import { describe, expect, it } from 'vitest';
import { feedbackStatusSchema } from '../../src/domain/types.js';
import { createOpenAiLlmClient } from '../../src/analysis/llm-client.js';
import { IN_MEMORY_PATH, openDatabase } from '../../src/db/database.js';
import { createFeedbackRepository } from '../../src/feedback/feedback.repository.js';
import { createLogger } from '../../src/logger.js';
import { processFeedback } from '../../src/queue/analysis-worker.js';
import { createTestConfig } from '../helpers/test-config.js';

describe('processFeedback with the real local model', () => {
  it('analyzes a RECEIVED item into DONE with one valid attempt', async () => {
    const config = createTestConfig();
    const repo = createFeedbackRepository(openDatabase(IN_MEMORY_PATH));
    const llm = createOpenAiLlmClient(config);
    const feedbackId = repo.insertOrGetExisting('Love the new editor, but please add keyboard shortcuts.').feedback.id;

    await processFeedback(feedbackId, { repo, llm, maxAttempts: config.MAX_ATTEMPTS, logger: createLogger('silent') });

    const detail = repo.getDetail(feedbackId);
    expect(detail?.status).toBe(feedbackStatusSchema.enum.DONE);
    expect(detail?.lastError).toBeNull();
    expect(detail?.attempts).toHaveLength(1);
    expect(detail?.attempts[0]?.result).not.toBeNull();
    expect(detail?.analysis).toEqual(detail?.attempts[0]?.result);
  });
});
