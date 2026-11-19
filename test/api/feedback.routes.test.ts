import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { analysisResultSchema, type AnalysisResult } from '../../src/analysis/analysis.schema.js';
import { buildApp } from '../../src/api/app.js';
import {
  errorResponseSchema,
  feedbackDetailSchema,
  feedbackListResponseSchema,
  retryConflictResponseSchema,
  retryFeedbackResponseSchema,
  submitFeedbackResponseSchema,
} from '../../src/api/feedback.schemas.js';
import { openDatabase } from '../../src/db/database.js';
import { createFeedbackRepository, type FeedbackRepository } from '../../src/feedback/feedback.repository.js';

const MAX_CONTENT_LENGTH = 50;

const VALID_RESULT: AnalysisResult = {
  sentiment: 'negative',
  feature_requests: [{ title: 'Dark mode', confidence: 0.8 }],
  actionable_insight: 'Add a dark theme.',
};

let repo: FeedbackRepository;
let enqueue: Mock<(feedbackId: string) => void>;
let app: FastifyInstance;

beforeEach(() => {
  repo = createFeedbackRepository(openDatabase(':memory:'));
  enqueue = vi.fn();
  app = buildApp({ repo, enqueue, maxContentLength: MAX_CONTENT_LENGTH });
});

afterEach(async () => {
  await app.close();
});

function insertFeedback(content: string): string {
  return repo.insertOrGetExisting(content).feedback.id;
}

function markFailed(feedbackId: string): void {
  repo.transition(feedbackId, 'RECEIVED', 'ANALYZING');
  repo.recordAttempt({ feedbackId, rawResponse: '{}', result: null, error: 'invalid output' });
  repo.transition(feedbackId, 'ANALYZING', 'FAILED', { lastError: 'invalid output' });
}

function markDone(feedbackId: string): void {
  repo.transition(feedbackId, 'RECEIVED', 'ANALYZING');
  repo.recordAttempt({ feedbackId, rawResponse: JSON.stringify(VALID_RESULT), result: VALID_RESULT, error: null });
  repo.transition(feedbackId, 'ANALYZING', 'DONE', { lastError: null });
}

describe('POST /feedback', () => {
  it('accepts new feedback with 202 and enqueues it', async () => {
    const response = await app.inject({ method: 'POST', url: '/feedback', payload: { content: 'Add dark mode' } });

    expect(response.statusCode).toBe(202);
    const body = submitFeedbackResponseSchema.parse(response.json());
    expect(body).toEqual({ id: body.id, status: 'RECEIVED', duplicate: false });
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(body.id);
  });

  it('returns the existing feedback with 200 for a duplicate and does not enqueue again', async () => {
    const first = await app.inject({ method: 'POST', url: '/feedback', payload: { content: 'Add dark mode' } });
    const second = await app.inject({ method: 'POST', url: '/feedback', payload: { content: '  add DARK mode ' } });

    expect(second.statusCode).toBe(200);
    const body = submitFeedbackResponseSchema.parse(second.json());
    expect(body.id).toBe(first.json().id);
    expect(body.duplicate).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('returns a duplicate in whatever status it has', async () => {
    const feedbackId = insertFeedback('Add dark mode');
    markFailed(feedbackId);

    const response = await app.inject({ method: 'POST', url: '/feedback', payload: { content: 'Add dark mode' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: feedbackId, status: 'FAILED', duplicate: true });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   \n\t '],
    ['too long', 'x'.repeat(MAX_CONTENT_LENGTH + 1)],
  ])('rejects %s content with 400', async (_case, content) => {
    const response = await app.inject({ method: 'POST', url: '/feedback', payload: { content } });

    expect(response.statusCode).toBe(400);
    expect(errorResponseSchema.parse(response.json()).error).toContain('content');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rejects a body without content with 400', async () => {
    const response = await app.inject({ method: 'POST', url: '/feedback', payload: {} });

    expect(response.statusCode).toBe(400);
    errorResponseSchema.parse(response.json());
  });
});

describe('GET /feedback', () => {
  it('lists feedback with analysis null while RECEIVED, using the default paging', async () => {
    const feedbackId = insertFeedback('Add dark mode');

    const response = await app.inject({ method: 'GET', url: '/feedback' });

    expect(response.statusCode).toBe(200);
    const body = feedbackListResponseSchema.parse(response.json());
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: feedbackId, status: 'RECEIVED', attemptCount: 0, analysis: null });
  });

  it('filters by status', async () => {
    insertFeedback('Add dark mode');
    const failedId = insertFeedback('The app crashes');
    markFailed(failedId);

    const response = await app.inject({ method: 'GET', url: '/feedback?status=FAILED' });

    const body = feedbackListResponseSchema.parse(response.json());
    expect(body.items.map((item) => item.id)).toEqual([failedId]);
    expect(body.items[0]?.lastError).toBe('invalid output');
  });

  it('applies limit and offset', async () => {
    insertFeedback('first');
    insertFeedback('second');
    insertFeedback('third');

    const response = await app.inject({ method: 'GET', url: '/feedback?limit=1&offset=1' });

    const body = feedbackListResponseSchema.parse(response.json());
    expect(body.items.map((item) => item.content)).toEqual(['second']);
    expect(body).toMatchObject({ limit: 1, offset: 1 });
  });

  it.each(['limit=0', 'limit=101', 'limit=abc', 'offset=-1', 'status=UNKNOWN'])(
    'rejects %s with 400',
    async (query) => {
      const response = await app.inject({ method: 'GET', url: `/feedback?${query}` });

      expect(response.statusCode).toBe(400);
      errorResponseSchema.parse(response.json());
    },
  );
});

describe('GET /feedback/:id', () => {
  it('returns the feedback with an empty attempt list', async () => {
    const feedbackId = insertFeedback('Add dark mode');

    const response = await app.inject({ method: 'GET', url: `/feedback/${feedbackId}` });

    expect(response.statusCode).toBe(200);
    const body = feedbackDetailSchema.parse(response.json());
    expect(body).toMatchObject({ id: feedbackId, content: 'Add dark mode', attempts: [], analysis: null });
  });

  it('returns 404 for an unknown id', async () => {
    const response = await app.inject({ method: 'GET', url: '/feedback/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Feedback not found' });
  });
});

describe('POST /feedback/:id/retry', () => {
  it('moves FAILED feedback back to RECEIVED with 202 and enqueues it', async () => {
    const feedbackId = insertFeedback('Add dark mode');
    markFailed(feedbackId);

    const response = await app.inject({ method: 'POST', url: `/feedback/${feedbackId}/retry` });

    expect(response.statusCode).toBe(202);
    expect(retryFeedbackResponseSchema.parse(response.json())).toEqual({ id: feedbackId, status: 'RECEIVED' });
    expect(repo.findById(feedbackId)?.status).toBe('RECEIVED');
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(feedbackId);
  });

  it('returns 409 with the current status for feedback that is not FAILED', async () => {
    const feedbackId = insertFeedback('Add dark mode');

    const response = await app.inject({ method: 'POST', url: `/feedback/${feedbackId}/retry` });

    expect(response.statusCode).toBe(409);
    expect(retryConflictResponseSchema.parse(response.json())).toEqual({
      error: 'Only FAILED feedback can be retried',
      status: 'RECEIVED',
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown id', async () => {
    const response = await app.inject({ method: 'POST', url: '/feedback/does-not-exist/retry' });

    expect(response.statusCode).toBe(404);
    expect(errorResponseSchema.parse(response.json())).toEqual({ error: 'Feedback not found' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('response contract for DONE feedback', () => {
  it('returns a valid analysis from both list and get', async () => {
    const feedbackId = insertFeedback('I want dark mode');
    markDone(feedbackId);

    const listResponse = await app.inject({ method: 'GET', url: '/feedback' });
    const detailResponse = await app.inject({ method: 'GET', url: `/feedback/${feedbackId}` });

    const list = feedbackListResponseSchema.parse(listResponse.json());
    expect(analysisResultSchema.parse(list.items[0]?.analysis)).toEqual(VALID_RESULT);

    const detail = feedbackDetailSchema.parse(detailResponse.json());
    expect(detail.status).toBe('DONE');
    expect(detail.attemptCount).toBe(1);
    expect(analysisResultSchema.parse(detail.analysis)).toEqual(VALID_RESULT);
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0]?.result).toEqual(VALID_RESULT);
  });
});
