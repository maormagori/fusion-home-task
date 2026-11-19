import { createOpenAiLlmClient } from './analysis/llm-client.js';
import { buildApp } from './api/app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createFeedbackRepository } from './feedback/feedback.repository.js';
import { createAnalysisQueue } from './queue/analysis-queue.js';
import { processFeedback } from './queue/analysis-worker.js';

const config = loadConfig();
const repo = createFeedbackRepository(openDatabase(config.DB_PATH));
const llm = createOpenAiLlmClient(config);
const queue = createAnalysisQueue(config.ANALYSIS_CONCURRENCY, (feedbackId) =>
  processFeedback(feedbackId, { repo, llm, maxAttempts: config.MAX_ATTEMPTS }),
);

// Queued jobs live only in memory, so work that was in flight or waiting when the
// previous process stopped must be picked up again before new requests arrive.
const interruptedCount = repo.resetInterruptedAnalyses();
const receivedIds = repo.listIdsByStatus('RECEIVED');
for (const feedbackId of receivedIds) {
  queue.enqueue(feedbackId);
}

const app = buildApp({
  repo,
  enqueue: queue.enqueue,
  maxContentLength: config.MAX_CONTENT_LENGTH,
  logLevel: config.LOG_LEVEL,
});
app.log.info(
  { interruptedCount, enqueuedCount: receivedIds.length },
  'Startup recovery: reset interrupted analyses and enqueued RECEIVED feedback',
);
await app.listen({ port: config.PORT });
