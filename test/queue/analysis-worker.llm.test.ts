import { describe, expect, it } from 'vitest';
import { createOpenAiLlmClient } from '../../src/analysis/llm-client.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/database.js';
import { createFeedbackRepository } from '../../src/feedback/feedback.repository.js';
import { processFeedback } from '../../src/queue/analysis-worker.js';

describe('processFeedback with the real local model', () => {
  it('analyzes a RECEIVED item into DONE with one valid attempt', async () => {
    const config = loadConfig({});
    const repo = createFeedbackRepository(openDatabase(':memory:'));
    const llm = createOpenAiLlmClient(config);
    const feedbackId = repo.insertOrGetExisting('Love the new editor, but please add keyboard shortcuts.').feedback.id;

    await processFeedback(feedbackId, { repo, llm, maxAttempts: config.MAX_ATTEMPTS });

    const detail = repo.getDetail(feedbackId);
    expect(detail?.status).toBe('DONE');
    expect(detail?.lastError).toBeNull();
    expect(detail?.attempts).toHaveLength(1);
    expect(detail?.attempts[0]?.result).not.toBeNull();
    expect(detail?.analysis).toEqual(detail?.attempts[0]?.result);
  });
});
