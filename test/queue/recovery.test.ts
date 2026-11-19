import { describe, expect, it } from 'vitest';
import { IN_MEMORY_PATH, openDatabase } from '../../src/db/database.js';
import { feedbackStatusSchema } from '../../src/domain/types.js';
import { createFeedbackRepository } from '../../src/feedback/feedback.repository.js';
import { createLogger } from '../../src/logger.js';
import { createAnalysisQueue } from '../../src/queue/analysis-queue.js';
import { recoverPendingAnalyses } from '../../src/queue/recovery.js';
import { createTestConfig } from '../helpers/test-config.js';

const { RECEIVED, ANALYZING, FAILED } = feedbackStatusSchema.enum;

describe('recoverPendingAnalyses', () => {
  it('resets interrupted work and queues all pending ids while leaving the DLQ alone', async () => {
    const repo = createFeedbackRepository(openDatabase(IN_MEMORY_PATH));
    const interrupted = repo.insertOrGetExisting('Interrupted feedback').feedback.id;
    const waiting = repo.insertOrGetExisting('Waiting feedback').feedback.id;
    const failed = repo.insertOrGetExisting('Failed feedback').feedback.id;
    const lastError = 'Attempts exhausted';
    repo.transition(interrupted, RECEIVED, ANALYZING);
    repo.transition(failed, RECEIVED, ANALYZING);
    repo.transition(failed, ANALYZING, FAILED, { lastError });
    const processedIds: string[] = [];
    const logger = createLogger('silent');
    const queue = createAnalysisQueue(createTestConfig().ANALYSIS_CONCURRENCY, async (feedbackId) => {
      expect(repo.findById(feedbackId)?.status).toBe(RECEIVED);
      processedIds.push(feedbackId);
    }, logger);

    expect(recoverPendingAnalyses(repo, queue, logger)).toEqual({ interruptedCount: 1, enqueuedCount: 2 });
    await queue.onIdle();

    expect(processedIds).toEqual([interrupted, waiting]);
    expect(repo.findById(failed)?.status).toBe(FAILED);
    expect(repo.findById(failed)?.lastError).toBe(lastError);
  });
});
