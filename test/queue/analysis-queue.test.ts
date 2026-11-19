import { describe, expect, it, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { createLogger } from '../../src/logger.js';
import { createAnalysisQueue } from '../../src/queue/analysis-queue.js';

const JOB_DURATION_MS = 20;
const CONCURRENCY = 2;

describe('createAnalysisQueue', () => {
  it('never runs more jobs at once than its concurrency and completes all of them', async () => {
    let jobsInFlight = 0;
    let maxJobsInFlight = 0;
    const completedIds: string[] = [];
    const queue = createAnalysisQueue(CONCURRENCY, async (feedbackId) => {
      jobsInFlight++;
      maxJobsInFlight = Math.max(maxJobsInFlight, jobsInFlight);
      await delay(JOB_DURATION_MS);
      jobsInFlight--;
      completedIds.push(feedbackId);
    }, createLogger('silent'));

    for (const feedbackId of ['a', 'b', 'c', 'd', 'e']) {
      queue.enqueue(feedbackId);
    }
    await queue.onIdle();

    expect(maxJobsInFlight).toBe(CONCURRENCY);
    expect(completedIds.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('logs a throwing job at error level and keeps running the others', async () => {
    const logger = createLogger('silent');
    const logError = vi.spyOn(logger, 'error');
    const completedIds: string[] = [];
    const queue = createAnalysisQueue(1, async (feedbackId) => {
      if (feedbackId === 'broken') {
        throw new Error('job exploded');
      }
      completedIds.push(feedbackId);
    }, logger);

    queue.enqueue('first');
    queue.enqueue('broken');
    queue.enqueue('last');
    await queue.onIdle();

    expect(completedIds).toEqual(['first', 'last']);
    expect(logError).toHaveBeenCalledWith({ feedbackId: 'broken', err: expect.any(Error) }, 'Analysis job threw');
  });
});
