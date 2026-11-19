import { feedbackStatusSchema } from '@feedback/shared/models';
import type { FeedbackRepository } from '../feedback/feedback.repository.js';
import type { Logger } from '../logger.js';
import type { AnalysisQueue } from './analysis-queue.js';

export function recoverPendingAnalyses(
  repo: FeedbackRepository,
  queue: AnalysisQueue,
  logger: Logger,
): { interruptedCount: number; enqueuedCount: number } {
  // Queued jobs live only in memory, so a restart must pick up interrupted and waiting work.
  const interruptedCount = repo.resetInterruptedAnalyses();
  const receivedIds = repo.listIdsByStatus(feedbackStatusSchema.enum.RECEIVED);
  const counts = { interruptedCount, enqueuedCount: receivedIds.length };
  logger.info(counts, 'Startup recovery: enqueuing RECEIVED feedback');
  for (const feedbackId of receivedIds) {
    queue.enqueue(feedbackId);
  }
  return counts;
}
