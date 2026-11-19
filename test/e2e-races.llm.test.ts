import { StatusCodes } from 'http-status-codes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAiLlmClient } from '../src/analysis/llm-client.js';
import { FEEDBACK_PATH, feedbackRetryUrl, submitFeedbackResponseSchema } from '../src/api/feedback.schemas.js';
import { feedbackStatusSchema } from '../src/domain/types.js';
import { processFeedback } from '../src/queue/analysis-worker.js';
import { recoverPendingAnalyses } from '../src/queue/recovery.js';
import { createUnreachableLlmTestConfig } from './helpers/test-config.js';
import { createRealWorkflow, expectSettled, waitForIdle, type WorkflowHarness } from './helpers/workflow-harness.js';

const { RECEIVED, ANALYZING, DONE, FAILED } = feedbackStatusSchema.enum;
const BURST_SIZE = 12;
const STATE_WAIT_MS = 10_000;
const CLAIM_MESSAGE = 'Feedback claimed for analysis';
let workflow: WorkflowHarness;
let releaseWorker: () => void = () => {};

afterEach(async () => {
  releaseWorker();
  await workflow.close();
});

describe('concurrent submissions, retry and recovery with real Ollama', () => {
  it('C01 makes concurrent normalized duplicates one row and one analysis run', async () => {
    workflow = createRealWorkflow();
    const logInfo = vi.spyOn(workflow.logger, 'info');
    const content = 'Please add offline editing.';
    const responses = await Promise.all(Array.from({ length: BURST_SIZE }, (_, index) => workflow.app.inject({
      method: 'POST', url: FEEDBACK_PATH,
      payload: { content: index % 2 === 0 ? content : `  ${content.toUpperCase().replaceAll(' ', '\n\t')}  ` },
    })));
    expect(responses.filter((response) => response.statusCode === StatusCodes.ACCEPTED)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === StatusCodes.OK)).toHaveLength(BURST_SIZE - 1);
    const submitted = responses.map((response) => submitFeedbackResponseSchema.parse(response.json()));
    expect(new Set(submitted.map((item) => item.id)).size).toBe(1);
    expect(submitted.filter((item) => item.duplicate)).toHaveLength(BURST_SIZE - 1);
    await waitForIdle(workflow.queue);
    const detail = await workflow.detail(submitFeedbackResponseSchema.parse(responses[0]?.json()).id);
    expectSettled(detail);
    expect(detail.status).toBe(DONE);
    expect(detail.attemptCount).toBeLessThanOrEqual(workflow.config.MAX_ATTEMPTS);
    expect(workflow.repo.list({ limit: BURST_SIZE, offset: 0 })).toHaveLength(1);
    expectClaims(logInfo.mock.calls, [detail.id]);
  });

  it('C02/D02 permits only one double-click retry and never requeues a FAILED duplicate', async () => {
    const gate = Promise.withResolvers<void>();
    releaseWorker = gate.resolve;
    workflow = createRealWorkflow(() => gate.promise);
    const content = 'Please add keyboard navigation.';
    const feedbackId = workflow.repo.insertOrGetExisting(content).feedback.id;
    await processFeedback(feedbackId, {
      repo: workflow.repo, logger: workflow.logger, maxAttempts: workflow.config.MAX_ATTEMPTS,
      llm: createOpenAiLlmClient(createUnreachableLlmTestConfig()),
    });
    const failed = await workflow.detail(feedbackId);
    expect(failed.status).toBe(FAILED);
    await expectDuplicate(content, feedbackId, FAILED);
    expect((await workflow.detail(feedbackId)).attempts).toEqual(failed.attempts);
    const logInfo = vi.spyOn(workflow.logger, 'info');

    const responses = await Promise.all(Array.from({ length: 2 }, () => workflow.app.inject({
      method: 'POST', url: feedbackRetryUrl(feedbackId),
    })));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([StatusCodes.ACCEPTED, StatusCodes.CONFLICT]);
    expect(workflow.repo.findById(feedbackId)?.status).toBe(RECEIVED);
    gate.resolve();
    await waitForIdle(workflow.queue);
    const done = await workflow.detail(feedbackId);
    expectSettled(done);
    expect(done.status).toBe(DONE);
    expect(done.attempts.slice(0, failed.attemptCount)).toEqual(failed.attempts);
    expect(done.attemptCount).toBeLessThanOrEqual(failed.attemptCount + workflow.config.MAX_ATTEMPTS);
    expectClaims(logInfo.mock.calls, [feedbackId]);
  });

  it('C03 claims recovered ids once even when the same id is enqueued again', async () => {
    workflow = createRealWorkflow();
    const logInfo = vi.spyOn(workflow.logger, 'info');
    const interrupted = workflow.repo.insertOrGetExisting('Please add dark mode.').feedback.id;
    const waiting = workflow.repo.insertOrGetExisting('The editor is excellent.').feedback.id;
    workflow.repo.transition(interrupted, RECEIVED, ANALYZING);
    expect(recoverPendingAnalyses(workflow.repo, workflow.queue, workflow.logger)).toEqual({ interruptedCount: 1, enqueuedCount: 2 });
    workflow.queue.enqueue(interrupted);
    workflow.queue.enqueue(waiting);
    await waitForIdle(workflow.queue);
    for (const feedbackId of [interrupted, waiting]) {
      const detail = await workflow.detail(feedbackId);
      expectSettled(detail);
      expect(detail.status).toBe(DONE);
      expect(detail.attemptCount).toBeLessThanOrEqual(workflow.config.MAX_ATTEMPTS);
    }
    expect(recoverPendingAnalyses(workflow.repo, workflow.queue, workflow.logger)).toEqual({ interruptedCount: 0, enqueuedCount: 0 });
    expectClaims(logInfo.mock.calls, [interrupted, waiting]);
  });

  it('C04 settles a burst of twelve with concurrency two and independent attempt histories', async () => {
    workflow = createRealWorkflow();
    const logInfo = vi.spyOn(workflow.logger, 'info');
    const feedbackIds = await Promise.all(Array.from({ length: BURST_SIZE }, (_, index) =>
      workflow.submit(`Feedback ${index}: please add keyboard shortcuts for editor command ${index}.`)));
    await waitForIdle(workflow.queue);
    expect(workflow.activity.maximum).toBe(workflow.config.ANALYSIS_CONCURRENCY);
    expect(workflow.activity.active).toBe(0);
    for (const feedbackId of feedbackIds) {
      const detail = await workflow.detail(feedbackId);
      expectSettled(detail);
      expect(detail.status).toBe(DONE);
      expect(detail.attemptCount).toBeLessThanOrEqual(workflow.config.MAX_ATTEMPTS);
      expect(detail.attempts.every((attempt) => attempt.feedbackId === feedbackId)).toBe(true);
    }
    expect(workflow.repo.listIdsByStatus(RECEIVED)).toEqual([]);
    expect(workflow.repo.listIdsByStatus(ANALYZING)).toEqual([]);
    expectClaims(logInfo.mock.calls, feedbackIds);
  });

  it('S03/D02 rejects retry and deduplicates while RECEIVED, ANALYZING and DONE', async () => {
    const gate = Promise.withResolvers<void>();
    releaseWorker = gate.resolve;
    workflow = createRealWorkflow(() => gate.promise);
    const content = 'Please support export to PDF.';
    const feedbackId = await workflow.submit(content);
    await expectRetryConflict(feedbackId, RECEIVED);
    await expectDuplicate(content, feedbackId, RECEIVED);
    gate.resolve();
    await expect.poll(() => workflow.repo.findById(feedbackId)?.status, { timeout: STATE_WAIT_MS, interval: 5 }).toBe(ANALYZING);
    await expectRetryConflict(feedbackId, ANALYZING);
    await expectDuplicate(content, feedbackId, ANALYZING);
    await waitForIdle(workflow.queue);
    const done = await workflow.detail(feedbackId);
    expectSettled(done);
    await expectRetryConflict(feedbackId, DONE);
    await expectDuplicate(content, feedbackId, DONE);
    await waitForIdle(workflow.queue);
    expect((await workflow.detail(feedbackId)).attempts).toEqual(done.attempts);
  });
});

async function expectDuplicate(content: string, feedbackId: string, status: string): Promise<void> {
  const response = await workflow.app.inject({ method: 'POST', url: FEEDBACK_PATH, payload: { content } });
  expect(response.statusCode).toBe(StatusCodes.OK);
  expect(submitFeedbackResponseSchema.parse(response.json())).toEqual({ id: feedbackId, status, duplicate: true });
}

async function expectRetryConflict(feedbackId: string, status: string): Promise<void> {
  const response = await workflow.app.inject({ method: 'POST', url: feedbackRetryUrl(feedbackId) });
  expect(response.statusCode).toBe(StatusCodes.CONFLICT);
  expect(response.json()).toMatchObject({ status });
}

function expectClaims(calls: readonly unknown[][], feedbackIds: string[]): void {
  const claims = calls.filter((call) => call[1] === CLAIM_MESSAGE);
  expect(claims).toHaveLength(feedbackIds.length);
  for (const feedbackId of feedbackIds) {
    expect(claims).toContainEqual([{ feedbackId }, CLAIM_MESSAGE]);
  }
}
