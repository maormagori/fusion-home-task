import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatusCodes } from 'http-status-codes';
import { expect, it } from 'vitest';
import { FEEDBACK_PATH, feedbackDetailUrl, submitFeedbackResponseSchema } from '@feedback/shared/api';
import { feedbackDetailSchema, feedbackStatusSchema, type FeedbackDetail } from '@feedback/shared/models';
import { createScriptedLlmServer } from './helpers/scripted-llm-server.js';
import { FETCH_TIMEOUT_MS, findAvailablePort, startServerProcess, type ServerProcess } from './helpers/server-process.js';
import { createTestConfig } from './helpers/test-config.js';
import { expectSettled, IDLE_TIMEOUT_MS, REAL_CALL_TIMEOUT_MS } from './helpers/workflow-harness.js';

const { RECEIVED, ANALYZING, DONE } = feedbackStatusSchema.enum;

it('S01 kills the actual server mid-analysis and recovers interrupted plus queued work on restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feedback-restart-'));
  const hold = Promise.withResolvers<void>();
  const invalid = '{before crash';
  const provider = await createScriptedLlmServer([
    { kind: 'completion', content: invalid },
    { kind: 'completion', content: null, waitFor: hold.promise },
  ]);
  const port = await findAvailablePort();
  const config = createTestConfig({
    DB_PATH: join(directory, 'feedback.db'), PORT: String(port), LOG_LEVEL: 'info',
    ANALYSIS_CONCURRENCY: '1', LLM_SDK_MAX_RETRIES: '0', LLM_TIMEOUT_MS: String(REAL_CALL_TIMEOUT_MS),
  });
  const crashed = startServerProcess({ ...config, LLM_BASE_URL: provider.baseUrl });
  let restarted: ServerProcess | undefined;
  try {
    await crashed.ready();
    const interrupted = await submit(crashed, 'Please add offline editing after a crash.');
    await expect.poll(() => provider.requests.length, { timeout: FETCH_TIMEOUT_MS }).toBe(2);
    const beforeCrash = await detail(crashed, interrupted);
    expect(beforeCrash.status).toBe(ANALYZING);
    expect(beforeCrash.attempts).toHaveLength(1);
    expect(beforeCrash.attempts[0]).toMatchObject({ rawResponse: invalid, result: null, error: expect.any(String) });
    const waiting = await submit(crashed, 'The editor is fast and easy to use.');
    expect((await detail(crashed, waiting)).status).toBe(RECEIVED);

    await crashed.stop('SIGKILL');
    restarted = startServerProcess(config);
    await restarted.ready();
    expect(restarted.logs.join('')).toContain('"interruptedCount":1,"enqueuedCount":2');
    for (const feedbackId of [interrupted, waiting]) {
      const server = restarted;
      await expect.poll(async () => (await detail(server, feedbackId)).status, { timeout: IDLE_TIMEOUT_MS }).toBe(DONE);
      expectSettled(await detail(server, feedbackId));
    }
    const afterRestart = await detail(restarted, interrupted);
    expect(afterRestart.attempts[0]).toEqual(beforeCrash.attempts[0]);
    expect(afterRestart.attempts[1]?.attemptNumber).toBe(2);
  } finally {
    try {
      await Promise.all([crashed.stop('SIGKILL'), restarted?.stop(), provider.close()]);
    } finally {
      rmSync(directory, { recursive: true });
    }
  }
});

async function submit(server: ServerProcess, content: string): Promise<string> {
  const response = await fetch(`${server.baseUrl}${FEEDBACK_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  expect(response.status).toBe(StatusCodes.ACCEPTED);
  return submitFeedbackResponseSchema.parse(await response.json()).id;
}

async function detail(server: ServerProcess, feedbackId: string): Promise<FeedbackDetail> {
  const response = await fetch(`${server.baseUrl}${feedbackDetailUrl(feedbackId)}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  expect(response.status).toBe(StatusCodes.OK);
  return feedbackDetailSchema.parse(await response.json());
}
