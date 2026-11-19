import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { StatusCodes } from 'http-status-codes';
import { afterEach, describe, expect, it } from 'vitest';
import { sentimentSchema } from '@feedback/shared/analysis';
import { createOpenAiLlmClient, LlmCallError } from '../../src/analysis/llm-client.js';
import { buildCorrectionMessages, buildInitialMessages } from '../../src/analysis/prompt.js';
import { IN_MEMORY_PATH, openDatabase } from '../../src/db/database.js';
import { feedbackStatusSchema } from '@feedback/shared/models';
import { createFeedbackRepository } from '../../src/feedback/feedback.repository.js';
import { createLogger } from '../../src/logger.js';
import { processFeedback } from '../../src/queue/analysis-worker.js';
import { createTestConfig } from '../helpers/test-config.js';

interface Reply { status: number; body: unknown }

const servers: Server[] = [];
const logger = createLogger('silent');
const result = {
  sentiment: sentimentSchema.enum.negative,
  feature_requests: [],
  actionable_insight: 'Fix the crash.',
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

describe('provider errors through the real SDK', () => {
  it.each([
    { status: StatusCodes.NOT_FOUND, retryable: false },
    { status: StatusCodes.INTERNAL_SERVER_ERROR, retryable: true },
  ])('wraps HTTP $status as LlmCallError with retryable=$retryable', async ({ status, retryable }) => {
    const { llm } = await setup(() => providerError(status));

    const completion = llm.complete(buildInitialMessages('The app crashes.'));

    await expect(completion).rejects.toBeInstanceOf(LlmCallError);
    await expect(completion).rejects.toMatchObject({ retryable, message: expect.stringContaining(String(status)) });
  });

  it.each([
    StatusCodes.BAD_REQUEST, StatusCodes.UNAUTHORIZED, StatusCodes.FORBIDDEN,
    StatusCodes.NOT_FOUND, StatusCodes.UNPROCESSABLE_ENTITY,
  ])('fails immediately after persisting permanent HTTP %i', async (status) => {
    const { repo, feedbackId, requests, run } = await setup(() => providerError(status));

    await run();

    const detail = repo.getDetail(feedbackId);
    expect(requests).toHaveLength(1);
    expect(detail).toMatchObject({ status: feedbackStatusSchema.enum.FAILED, analysis: null,
      attempts: [{ attemptNumber: 1, rawResponse: null, result: null, error: expect.stringContaining(String(status)) }],
    });
    expect(detail?.lastError).toBe(detail?.attempts[0]?.error);
  });

  it.each([
    StatusCodes.REQUEST_TIMEOUT, StatusCodes.CONFLICT, StatusCodes.TOO_MANY_REQUESTS,
    StatusCodes.INTERNAL_SERVER_ERROR, StatusCodes.SERVICE_UNAVAILABLE,
  ])('keeps bounded application retries for transient HTTP %i', async (status) => {
    const { repo, feedbackId, requests, config, run } = await setup(() => providerError(status));

    await run();

    const detail = repo.getDetail(feedbackId);
    expect(requests).toHaveLength(config.MAX_ATTEMPTS);
    expect(detail?.status).toBe(feedbackStatusSchema.enum.FAILED);
    expect(detail?.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2, 3]);
    expect(detail?.lastError).toBe(detail?.attempts.at(-1)?.error);
  });

  it('preserves raw blank output and correction history across a transient error', async () => {
    const invalidRaw = JSON.stringify({ ...result, actionable_insight: ' \n\t' });
    const { repo, feedbackId, requests, config, run } = await setup((index) => {
      if (index === 1) return providerError(StatusCodes.SERVICE_UNAVAILABLE);
      const content = index === 0 ? invalidRaw : JSON.stringify(result);
      return { status: StatusCodes.OK, body: {
        id: 'scripted', object: 'chat.completion', created: 0, model: config.LLM_MODEL,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      } };
    });

    await run();

    const detail = repo.getDetail(feedbackId);
    expect(detail).toMatchObject({ status: feedbackStatusSchema.enum.DONE, lastError: null, analysis: result,
      attempts: [
        { attemptNumber: 1, rawResponse: invalidRaw, result: null, error: expect.stringContaining('actionable_insight') },
        { attemptNumber: 2, rawResponse: null, result: null, error: expect.stringContaining(String(StatusCodes.SERVICE_UNAVAILABLE)) },
        { attemptNumber: 3, rawResponse: JSON.stringify(result), result, error: null },
      ],
    });
    const error = detail?.attempts[0]?.error;
    expect(typeof error).toBe('string');
    const messages = [...buildInitialMessages('The app crashes.'), ...buildCorrectionMessages(invalidRaw, error ?? '')];
    expect(requests).toHaveLength(3);
    expect(JSON.parse(requests[1] ?? '')).toMatchObject({ messages });
    expect(JSON.parse(requests[2] ?? '')).toMatchObject({ messages });
  });
});

async function setup(replyForRequest: (index: number) => Reply) {
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const reply = replyForRequest(requests.length);
    requests.push(body);
    response.writeHead(reply.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(reply.body));
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP test server');
  const config = createTestConfig({
    LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, LLM_SDK_MAX_RETRIES: '0', MAX_ATTEMPTS: '3',
  });
  const repo = createFeedbackRepository(openDatabase(IN_MEMORY_PATH));
  const feedbackId = repo.insertOrGetExisting('The app crashes.').feedback.id;
  const llm = createOpenAiLlmClient(config);
  return { repo, feedbackId, requests, config, llm,
    run: () => processFeedback(feedbackId, { repo, llm, maxAttempts: config.MAX_ATTEMPTS, logger }),
  };
}

function providerError(status: number): Reply {
  return { status, body: { error: { message: `Provider rejected request with HTTP ${status}`, type: 'test_error' } } };
}
