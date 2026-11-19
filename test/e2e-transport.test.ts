import { setTimeout as delay } from 'node:timers/promises';
import { StatusCodes } from 'http-status-codes';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCorrectionMessages, buildInitialMessages } from '../src/analysis/prompt.js';
import { feedbackStatusSchema } from '../src/domain/types.js';
import { createScriptedWorkflow, VALID_RAW } from './helpers/scripted-workflow.js';
import { createUnreachableLlmTestConfig } from './helpers/test-config.js';
import { createWorkflowHarness, expectSettled, waitForIdle, type WorkflowHarness } from './helpers/workflow-harness.js';

const { DONE, FAILED } = feedbackStatusSchema.enum;
const TRANSIENT_STATUSES = [StatusCodes.INTERNAL_SERVER_ERROR, StatusCodes.TOO_MANY_REQUESTS];
const SDK_RETRIES = 2;
const MAX_ATTEMPTS = 2;
const TIMEOUT_MS = 100;
const LATE_RESPONSE_MS = 350;
const PROVIDER_ERROR = 'Scripted provider unavailable';
let workflow: WorkflowHarness;

afterEach(async () => {
  await workflow.close();
});

describe('transport failures with the real SDK', () => {
  it.each(TRANSIENT_STATUSES)('T01 retries HTTP %s inside one worker attempt', async (status) => {
    const scripted = await createScriptedWorkflow([
      { kind: 'http_error', status, message: PROVIDER_ERROR }, { kind: 'completion', content: VALID_RAW },
    ], { LLM_SDK_MAX_RETRIES: String(SDK_RETRIES) });
    workflow = scripted;
    const feedbackId = await workflow.submit('Transient provider failure');
    await waitForIdle(workflow.queue);
    const detail = await workflow.detail(feedbackId);

    expectSettled(detail);
    expect(detail.status).toBe(DONE);
    expect(detail.attempts).toHaveLength(1);
    expect(scripted.server.requests).toHaveLength(2);
    expect(scripted.server.requests[1]).toEqual(scripted.server.requests[0]);
  });

  it.each(TRANSIENT_STATUSES)('T02 exhausts SDK and worker retry budgets for HTTP %s', async (status) => {
    const sends = MAX_ATTEMPTS * (SDK_RETRIES + 1);
    const scripted = await createScriptedWorkflow(Array.from({ length: sends }, () => ({
      kind: 'http_error', status, message: PROVIDER_ERROR,
    })), { MAX_ATTEMPTS: String(MAX_ATTEMPTS), LLM_SDK_MAX_RETRIES: String(SDK_RETRIES) });
    workflow = scripted;
    const feedbackId = await workflow.submit('Persistent provider failure');
    await waitForIdle(workflow.queue);
    const detail = await workflow.detail(feedbackId);

    expectSettled(detail);
    expect(detail.status).toBe(FAILED);
    expect(detail.attempts).toHaveLength(MAX_ATTEMPTS);
    expect(scripted.server.requests).toHaveLength(sends);
    for (const attempt of detail.attempts) {
      expect(attempt).toMatchObject({ rawResponse: null, result: null, error: expect.stringContaining(PROVIDER_ERROR) });
    }
  });

  it.each([false, true])('T03 applies call timeout and ignores late responses; recovery=%s', async (doesRecover) => {
    const scripted = await createScriptedWorkflow([
      { kind: 'completion', content: VALID_RAW, delayMs: LATE_RESPONSE_MS },
      { kind: 'completion', content: VALID_RAW, delayMs: doesRecover ? 0 : LATE_RESPONSE_MS },
    ], { LLM_TIMEOUT_MS: String(TIMEOUT_MS), MAX_ATTEMPTS: String(MAX_ATTEMPTS) });
    workflow = scripted;
    const startedAt = performance.now();
    const feedbackId = await workflow.submit('Provider response arrives after timeout');
    await waitForIdle(workflow.queue);
    const detail = await workflow.detail(feedbackId);

    expectSettled(detail);
    expect(detail.status).toBe(doesRecover ? DONE : FAILED);
    expect(detail.attempts).toHaveLength(MAX_ATTEMPTS);
    expect(detail.attempts[0]).toMatchObject({ rawResponse: null, result: null, error: expect.stringMatching(/timed out/i) });
    expect(scripted.server.requests).toHaveLength(MAX_ATTEMPTS);
    expect(performance.now() - startedAt).toBeLessThan(LATE_RESPONSE_MS * 5);
    await delay(LATE_RESPONSE_MS);
    expect(await workflow.detail(feedbackId)).toEqual(detail);
  });

  it('T04 exhausts connection refusal through HTTP without leaving pending work', async () => {
    workflow = createWorkflowHarness(createUnreachableLlmTestConfig());
    const feedbackId = await workflow.submit('Connection refused for every attempt');
    await waitForIdle(workflow.queue);
    const detail = await workflow.detail(feedbackId);

    expectSettled(detail);
    expect(detail.status).toBe(FAILED);
    expect(detail.attempts).toHaveLength(workflow.config.MAX_ATTEMPTS);
    for (const attempt of detail.attempts) {
      expect(attempt).toMatchObject({ rawResponse: null, result: null, error: expect.any(String) });
    }
  });

  it.each([false, true])('T05 keeps correction history after transport failure; recovery=%s', async (doesRecover) => {
    const invalid = '{broken';
    const content = 'Invalid then transport failure';
    const scripted = await createScriptedWorkflow([
      { kind: 'completion', content: invalid },
      { kind: 'http_error', status: StatusCodes.INTERNAL_SERVER_ERROR, message: PROVIDER_ERROR },
      { kind: 'completion', content: VALID_RAW },
    ], { MAX_ATTEMPTS: doesRecover ? '3' : '2' });
    workflow = scripted;
    const feedbackId = await workflow.submit(content);
    await waitForIdle(workflow.queue);
    const detail = await workflow.detail(feedbackId);

    expectSettled(detail);
    expect(detail.status).toBe(doesRecover ? DONE : FAILED);
    expect(detail.attempts).toHaveLength(workflow.config.MAX_ATTEMPTS);
    expect(detail.attempts[0]).toMatchObject({ rawResponse: invalid, result: null, error: expect.any(String) });
    expect(detail.attempts[1]).toMatchObject({ rawResponse: null, result: null, error: expect.stringContaining(PROVIDER_ERROR) });
    expect(scripted.server.requests[1]?.messages).toEqual([
      ...buildInitialMessages(content), ...buildCorrectionMessages(invalid, detail.attempts[0]?.error ?? ''),
    ]);
    if (doesRecover) {
      expect(scripted.server.requests[2]?.messages).toEqual(scripted.server.requests[1]?.messages);
    }
    expect(scripted.server.requests).toHaveLength(workflow.config.MAX_ATTEMPTS);
  });
});
