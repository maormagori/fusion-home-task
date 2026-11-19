import PQueue from 'p-queue';
import type { Logger } from '../logger.js';

export interface AnalysisQueue {
  enqueue(feedbackId: string): void;
  onIdle(): Promise<void>;
}

export function createAnalysisQueue(
  concurrency: number,
  process: (feedbackId: string) => Promise<void>,
  logger: Logger,
): AnalysisQueue {
  const queue = new PQueue({ concurrency });

  async function runJob(feedbackId: string): Promise<void> {
    try {
      await process(feedbackId);
    } catch (error) {
      // Last resort: processFeedback handles its own errors, so this only runs if that handling itself
      // failed (e.g. the database is gone). Nobody awaits a queued job, so without it the error is unhandled.
      logger.error({ feedbackId, err: error }, 'Analysis job threw');
    }
  }

  return {
    enqueue(feedbackId: string): void {
      void queue.add(() => runJob(feedbackId));
    },
    onIdle(): Promise<void> {
      return queue.onIdle();
    },
  };
}
