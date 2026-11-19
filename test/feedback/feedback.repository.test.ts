import { beforeEach, describe, expect, it } from 'vitest';
import { feedbackStatusSchema } from '../../src/domain/types.js';
import { IN_MEMORY_PATH, openDatabase } from '../../src/db/database.js';
import { createFeedbackRepository, type FeedbackRepository } from '../../src/feedback/feedback.repository.js';
import { sentimentSchema, type AnalysisResult } from '../../src/analysis/analysis.schema.js';

const VALID_RESULT: AnalysisResult = {
  sentiment: sentimentSchema.enum.positive,
  feature_requests: [{ title: 'Dark mode', confidence: 0.9 }],
  actionable_insight: 'Ship a dark theme.',
};

let repo: FeedbackRepository;

beforeEach(() => {
  repo = createFeedbackRepository(openDatabase(IN_MEMORY_PATH));
});

function insertFeedback(content: string): string {
  return repo.insertOrGetExisting(content).feedback.id;
}

function recordFailedAttempt(feedbackId: string): void {
  repo.recordAttempt({ feedbackId, rawResponse: '{}', result: null, error: 'invalid output' });
}

function markDone(feedbackId: string): void {
  repo.transition(feedbackId, feedbackStatusSchema.enum.RECEIVED, feedbackStatusSchema.enum.ANALYZING);
  repo.recordAttempt({ feedbackId, rawResponse: JSON.stringify(VALID_RESULT), result: VALID_RESULT, error: null });
  repo.transition(feedbackId, feedbackStatusSchema.enum.ANALYZING, feedbackStatusSchema.enum.DONE, { lastError: null });
}

describe('insertOrGetExisting', () => {
  it('creates a RECEIVED feedback that keeps the original content', () => {
    const { feedback, created } = repo.insertOrGetExisting('  Add  Dark Mode ');

    expect(created).toBe(true);
    expect(feedback.status).toBe(feedbackStatusSchema.enum.RECEIVED);
    expect(feedback.content).toBe('  Add  Dark Mode ');
    expect(feedback.lastError).toBeNull();
    expect(feedback.createdAt).toBe(feedback.updatedAt);
  });

  it('returns the existing feedback for normalized-equal content', () => {
    const first = repo.insertOrGetExisting('Add dark mode');
    const second = repo.insertOrGetExisting('  add   DARK mode ');

    expect(second.created).toBe(false);
    expect(second.feedback.id).toBe(first.feedback.id);
    expect(second.feedback.content).toBe('Add dark mode');
  });
});

describe('transition', () => {
  it('changes the status when the current status matches', () => {
    const feedbackId = insertFeedback('hello');

    expect(repo.transition(feedbackId, feedbackStatusSchema.enum.RECEIVED, feedbackStatusSchema.enum.ANALYZING)).toBe(true);
    expect(repo.findById(feedbackId)?.status).toBe(feedbackStatusSchema.enum.ANALYZING);
  });

  it('returns false and leaves the row unchanged when the current status differs', () => {
    const feedbackId = insertFeedback('hello');
    const before = repo.findById(feedbackId);

    expect(repo.transition(feedbackId, feedbackStatusSchema.enum.ANALYZING, feedbackStatusSchema.enum.DONE)).toBe(false);
    expect(repo.findById(feedbackId)).toEqual(before);
  });

  it('returns false for an unknown id', () => {
    expect(repo.transition('missing-id', feedbackStatusSchema.enum.RECEIVED, feedbackStatusSchema.enum.ANALYZING)).toBe(false);
  });

  it('sets lastError, keeps it when not given, and clears it with null', () => {
    const feedbackId = insertFeedback('hello');
    repo.transition(feedbackId, feedbackStatusSchema.enum.RECEIVED, feedbackStatusSchema.enum.ANALYZING);
    repo.transition(feedbackId, feedbackStatusSchema.enum.ANALYZING, feedbackStatusSchema.enum.FAILED, { lastError: 'model timed out' });
    expect(repo.findById(feedbackId)?.lastError).toBe('model timed out');

    repo.transition(feedbackId, feedbackStatusSchema.enum.FAILED, feedbackStatusSchema.enum.RECEIVED);
    expect(repo.findById(feedbackId)?.lastError).toBe('model timed out');

    repo.transition(feedbackId, feedbackStatusSchema.enum.RECEIVED, feedbackStatusSchema.enum.ANALYZING);
    repo.transition(feedbackId, feedbackStatusSchema.enum.ANALYZING, feedbackStatusSchema.enum.DONE, { lastError: null });
    expect(repo.findById(feedbackId)?.lastError).toBeNull();
  });
});

describe('recordAttempt', () => {
  it('numbers attempts 1, 2, 3 per feedback, independently between feedbacks', () => {
    const firstId = insertFeedback('first');
    const secondId = insertFeedback('second');

    const numbers = [
      repo.recordAttempt({ feedbackId: firstId, rawResponse: null, result: null, error: 'timeout' }),
      repo.recordAttempt({ feedbackId: firstId, rawResponse: 'not json', result: null, error: 'bad json' }),
      repo.recordAttempt({ feedbackId: secondId, rawResponse: null, result: null, error: 'timeout' }),
      repo.recordAttempt({ feedbackId: firstId, rawResponse: '{}', result: VALID_RESULT, error: null }),
    ].map((attempt) => [attempt.feedbackId, attempt.attemptNumber]);

    expect(numbers).toEqual([[firstId, 1], [firstId, 2], [secondId, 1], [firstId, 3]]);
  });

  it('stores the raw response and round-trips the result', () => {
    const feedbackId = insertFeedback('hello');

    const attempt = repo.recordAttempt({ feedbackId, rawResponse: 'raw text', result: VALID_RESULT, error: null });

    expect(attempt.rawResponse).toBe('raw text');
    expect(attempt.result).toEqual(VALID_RESULT);
    expect(repo.getDetail(feedbackId)?.attempts).toEqual([attempt]);
  });

  it('bumps the feedback updatedAt', () => {
    const { feedback } = repo.insertOrGetExisting('hello');

    const attempt = repo.recordAttempt({ feedbackId: feedback.id, rawResponse: null, result: null, error: 'timeout' });

    expect(repo.findById(feedback.id)?.updatedAt).toBe(attempt.createdAt);
  });
});

describe('getDetail', () => {
  it('returns null for an unknown id', () => {
    expect(repo.getDetail('missing-id')).toBeNull();
  });

  it('returns attempts ordered by attemptNumber with the analysis of a DONE item', () => {
    const feedbackId = insertFeedback('hello');
    recordFailedAttempt(feedbackId);
    markDone(feedbackId);

    const detail = repo.getDetail(feedbackId);

    expect(detail?.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(detail?.attemptCount).toBe(2);
    expect(detail?.analysis).toEqual(VALID_RESULT);
  });
});

describe('list', () => {
  it('returns newest first with limit and offset', () => {
    const ids = ['one', 'two', 'three'].map(insertFeedback);

    const page = repo.list({ limit: 2, offset: 1 });

    expect(page.map((item) => item.id)).toEqual([ids[1], ids[0]]);
  });

  it('filters by status', () => {
    const receivedId = insertFeedback('received');
    const doneId = insertFeedback('done');
    markDone(doneId);

    expect(repo.list({ status: feedbackStatusSchema.enum.DONE, limit: 10, offset: 0 }).map((item) => item.id)).toEqual([doneId]);
    expect(repo.list({ status: feedbackStatusSchema.enum.RECEIVED, limit: 10, offset: 0 }).map((item) => item.id)).toEqual([receivedId]);
  });

  it('counts attempts and returns analysis only for DONE items', () => {
    const noAttemptsId = insertFeedback('no attempts');
    const failedId = insertFeedback('failed');
    recordFailedAttempt(failedId);
    recordFailedAttempt(failedId);
    const doneId = insertFeedback('done');
    markDone(doneId);

    const views = repo.list({ limit: 10, offset: 0 });
    const byId = new Map(views.map((view) => [view.id, view]));

    expect(byId.get(noAttemptsId)).toMatchObject({ attemptCount: 0, analysis: null });
    expect(byId.get(failedId)).toMatchObject({ attemptCount: 2, analysis: null });
    expect(byId.get(doneId)).toMatchObject({ attemptCount: 1, analysis: VALID_RESULT });
  });

  it('hides the analysis once a DONE item has left DONE', () => {
    const feedbackId = insertFeedback('hello');
    markDone(feedbackId);
    // Only the status matters here, so this skips the state rules to reach a non-DONE item with a result.
    repo.transition(feedbackId, feedbackStatusSchema.enum.DONE, feedbackStatusSchema.enum.RECEIVED);

    expect(repo.list({ limit: 10, offset: 0 })[0]?.analysis).toBeNull();
  });
});

describe('resetInterruptedAnalyses', () => {
  it('moves only ANALYZING items back to RECEIVED and returns the count', () => {
    const analyzingIds = [insertFeedback('a'), insertFeedback('b')];
    for (const feedbackId of analyzingIds) {
      repo.transition(feedbackId, feedbackStatusSchema.enum.RECEIVED, feedbackStatusSchema.enum.ANALYZING);
    }
    const doneId = insertFeedback('c');
    markDone(doneId);

    expect(repo.resetInterruptedAnalyses()).toBe(2);
    expect(repo.listIdsByStatus(feedbackStatusSchema.enum.RECEIVED)).toEqual(analyzingIds);
    expect(repo.findById(doneId)?.status).toBe(feedbackStatusSchema.enum.DONE);
  });
});

describe('listIdsByStatus', () => {
  it('returns ids with that status, oldest first', () => {
    const firstId = insertFeedback('first');
    const doneId = insertFeedback('done');
    const lastId = insertFeedback('last');
    markDone(doneId);

    expect(repo.listIdsByStatus(feedbackStatusSchema.enum.RECEIVED)).toEqual([firstId, lastId]);
    expect(repo.listIdsByStatus(feedbackStatusSchema.enum.DONE)).toEqual([doneId]);
  });
});
