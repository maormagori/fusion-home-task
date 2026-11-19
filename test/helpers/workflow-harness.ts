import { StatusCodes } from 'http-status-codes';
import { expect } from 'vitest';
import { analysisResultSchema } from '../../src/analysis/analysis.schema.js';
import { createOpenAiLlmClient } from '../../src/analysis/llm-client.js';
import { buildApp } from '../../src/api/app.js';
import { FEEDBACK_PATH, feedbackDetailUrl, submitFeedbackResponseSchema } from '../../src/api/feedback.schemas.js';
import type { Config } from '../../src/config.js';
import { IN_MEMORY_PATH, openDatabase } from '../../src/db/database.js';
import { feedbackDetailSchema, feedbackStatusSchema, type FeedbackDetail } from '../../src/domain/types.js';
import { createFeedbackRepository } from '../../src/feedback/feedback.repository.js';
import { createLogger } from '../../src/logger.js';
import { createAnalysisQueue } from '../../src/queue/analysis-queue.js';
import { processFeedback } from '../../src/queue/analysis-worker.js';
import { createTestConfig } from './test-config.js';

export const IDLE_TIMEOUT_MS = 100_000;
export const REAL_CALL_TIMEOUT_MS = 30_000;

export interface WorkflowHarness {
  config: Config;
  repo: ReturnType<typeof createFeedbackRepository>;
  logger: ReturnType<typeof createLogger>;
  queue: ReturnType<typeof createAnalysisQueue>;
  app: ReturnType<typeof buildApp>;
  activity: { active: number; maximum: number };
  submit(content: string): Promise<string>;
  detail(feedbackId: string): Promise<FeedbackDetail>;
  close(): Promise<void>;
}

export function createRealWorkflow(beforeProcess?: () => Promise<void>): WorkflowHarness {
  return createWorkflowHarness(createTestConfig({
    ANALYSIS_CONCURRENCY: '2', LLM_SDK_MAX_RETRIES: '0', LLM_TIMEOUT_MS: String(REAL_CALL_TIMEOUT_MS),
  }), beforeProcess);
}

export function createWorkflowHarness(config: Config, beforeProcess?: () => Promise<void>): WorkflowHarness {
  const repo = createFeedbackRepository(openDatabase(IN_MEMORY_PATH));
  const logger = createLogger('silent');
  const llm = createOpenAiLlmClient(config);
  const activity = { active: 0, maximum: 0 };
  const queue = createAnalysisQueue(config.ANALYSIS_CONCURRENCY, async (feedbackId) => {
    activity.active++;
    activity.maximum = Math.max(activity.maximum, activity.active);
    try {
      await beforeProcess?.();
      await processFeedback(feedbackId, { repo, llm, maxAttempts: config.MAX_ATTEMPTS, logger });
    } finally {
      activity.active--;
    }
  }, logger);
  const app = buildApp({ repo, logger, enqueue: queue.enqueue, maxContentLength: config.MAX_CONTENT_LENGTH });
  return {
    config, repo, logger, queue, app, activity,
    async submit(content: string): Promise<string> {
      const response = await app.inject({ method: 'POST', url: FEEDBACK_PATH, payload: { content } });
      expect(response.statusCode).toBe(StatusCodes.ACCEPTED);
      return submitFeedbackResponseSchema.parse(response.json()).id;
    },
    async detail(feedbackId: string): Promise<FeedbackDetail> {
      const response = await app.inject({ method: 'GET', url: feedbackDetailUrl(feedbackId) });
      expect(response.statusCode).toBe(StatusCodes.OK);
      return feedbackDetailSchema.parse(response.json());
    },
    async close(): Promise<void> {
      await waitForIdle(queue);
      await app.close();
    },
  };
}

export async function waitForIdle(queue: { onIdle(): Promise<void> }): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      queue.onIdle(),
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Analysis queue did not settle before the test deadline')), IDLE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function expectSettled(detail: FeedbackDetail): void {
  const { DONE, FAILED } = feedbackStatusSchema.enum;
  expect([DONE, FAILED]).toContain(detail.status);
  expect(detail.attemptCount).toBe(detail.attempts.length);
  expect(detail.attempts.map((attempt) => attempt.attemptNumber)).toEqual(
    Array.from({ length: detail.attemptCount }, (_, index) => index + 1),
  );
  if (detail.status === DONE) {
    analysisResultSchema.parse(detail.analysis);
    expect(detail.lastError).toBeNull();
    expect(detail.attempts.filter((attempt) => attempt.result !== null)).toHaveLength(1);
    expect(detail.analysis).toEqual(detail.attempts.at(-1)?.result);
    return;
  }
  expect(detail.analysis).toBeNull();
  expect(detail.lastError).toBeTruthy();
  expect(detail.lastError).toBe(detail.attempts.at(-1)?.error);
}
