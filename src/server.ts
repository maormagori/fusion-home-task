import { fileURLToPath } from 'node:url';
import { createOpenAiLlmClient } from './analysis/llm-client.js';
import { buildApp } from './api/app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createFeedbackRepository } from './feedback/feedback.repository.js';
import { createLogger } from './logger.js';
import { createAnalysisQueue } from './queue/analysis-queue.js';
import { processFeedback } from './queue/analysis-worker.js';
import { recoverPendingAnalyses } from './queue/recovery.js';

// Resolved from this file rather than the working directory, so `npm run dev` works from any folder.
const UI_DIST_PATH = fileURLToPath(new URL('../web/dist', import.meta.url));

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const repo = createFeedbackRepository(openDatabase(config.DB_PATH));
const llm = createOpenAiLlmClient(config);
const queue = createAnalysisQueue(
  config.ANALYSIS_CONCURRENCY,
  (feedbackId) => processFeedback(feedbackId, { repo, llm, maxAttempts: config.MAX_ATTEMPTS, logger }),
  logger,
);

recoverPendingAnalyses(repo, queue, logger);

const app = buildApp({
  repo,
  enqueue: queue.enqueue,
  maxContentLength: config.MAX_CONTENT_LENGTH,
  logger,
  uiDistPath: UI_DIST_PATH,
});
await app.listen({ port: config.PORT });
