import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, max, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/database.js';
import { analysisAttempts, feedback } from '../db/schema.js';
import type { AnalysisResult } from '../analysis/analysis.schema.js';
import type {
  AnalysisAttempt, Feedback, FeedbackDetail, FeedbackStatus, FeedbackView,
} from '../domain/types.js';
import { feedbackStatusSchema } from '../domain/types.js';
import { hashContent } from './content-hash.js';

export interface FeedbackRepository {
  insertOrGetExisting(content: string): { feedback: Feedback; created: boolean };
  transition(id: string, from: FeedbackStatus, to: FeedbackStatus,
             fields?: { lastError?: string | null }): boolean;
  findById(id: string): Feedback | null;
  getDetail(id: string): FeedbackDetail | null;
  list(params: { status?: FeedbackStatus; limit: number; offset: number }): FeedbackView[];
  recordAttempt(input: { feedbackId: string; rawResponse: string | null;
                         result: AnalysisResult | null; error: string | null }): AnalysisAttempt;
  completeAnalysis(input: { feedbackId: string; rawResponse: string; result: AnalysisResult }):
    { attempt: AnalysisAttempt; completed: true } | { attempt: null; completed: false };
  resetInterruptedAnalyses(): number;
  listIdsByStatus(status: FeedbackStatus): string[];
}

type FeedbackRow = typeof feedback.$inferSelect;
type FeedbackUpdate = Partial<typeof feedback.$inferInsert>;
type AttemptRow = typeof analysisAttempts.$inferSelect;

// created_at can repeat within one millisecond, so insertion order (rowid) breaks ties.
const insertionOrder = sql`${feedback}.rowid`;

export function createFeedbackRepository(db: Database): FeedbackRepository {
  function findByHash(contentHash: string): Feedback {
    const row = db.select().from(feedback).where(eq(feedback.contentHash, contentHash)).get();
    if (!row) {
      throw new Error(`Feedback with content hash ${contentHash} not found after insert`);
    }
    return toFeedback(row);
  }

  function selectViews(where: SQL | undefined, limit: number, offset: number): FeedbackView[] {
    const attemptStats = db
      .select({
        feedbackId: analysisAttempts.feedbackId,
        attemptCount: count().as('attempt_count'),
        latestValidAttempt: sql<number | null>`
          max(${analysisAttempts.attemptNumber}) filter (where ${analysisAttempts.resultJson} is not null)
        `.as('latest_valid_attempt'),
      })
      .from(analysisAttempts)
      .groupBy(analysisAttempts.feedbackId)
      .as('attempt_stats');

    const rows = db
      .select({
        feedback,
        attemptCount: sql<number>`coalesce(${attemptStats.attemptCount}, 0)`,
        resultJson: analysisAttempts.resultJson,
      })
      .from(feedback)
      .leftJoin(attemptStats, eq(attemptStats.feedbackId, feedback.id))
      .leftJoin(analysisAttempts, and(
        eq(analysisAttempts.feedbackId, feedback.id),
        eq(analysisAttempts.attemptNumber, attemptStats.latestValidAttempt),
      ))
      .where(where)
      .orderBy(desc(feedback.createdAt), desc(insertionOrder))
      .limit(limit)
      .offset(offset)
      .all();

    const views: FeedbackView[] = [];
    for (const row of rows) {
      const isDone = row.feedback.status === feedbackStatusSchema.enum.DONE;
      views.push({
        ...toFeedback(row.feedback),
        attemptCount: row.attemptCount,
        analysis: isDone ? parseResult(row.resultJson) : null,
      });
    }
    return views;
  }

  function transition(
    id: string, from: FeedbackStatus, to: FeedbackStatus,
    fields: { lastError?: string | null } = {},
  ): boolean {
    const updates: FeedbackUpdate = { status: to, updatedAt: currentTimestamp() };
    if (fields.lastError !== undefined) {
      updates.lastError = fields.lastError;
    }
    const updateResult = db
      .update(feedback)
      .set(updates)
      .where(and(eq(feedback.id, id), eq(feedback.status, from)))
      .run();
    return updateResult.changes === 1;
  }

  function recordAttempt({ feedbackId, rawResponse, result, error }: {
    feedbackId: string; rawResponse: string | null; result: AnalysisResult | null; error: string | null;
  }): AnalysisAttempt {
    // The max+1 read and the insert share a transaction so no other write can take the same number.
    return db.transaction((tx) => {
      const now = currentTimestamp();
      const latest = tx
        .select({ attemptNumber: max(analysisAttempts.attemptNumber) })
        .from(analysisAttempts)
        .where(eq(analysisAttempts.feedbackId, feedbackId))
        .get();
      const attemptNumber = (latest?.attemptNumber ?? 0) + 1;

      const row = tx
        .insert(analysisAttempts)
        .values({
          feedbackId, attemptNumber, rawResponse, error, createdAt: now,
          resultJson: result ? JSON.stringify(result) : null,
        })
        .returning()
        .get();
      tx.update(feedback).set({ updatedAt: now }).where(eq(feedback.id, feedbackId)).run();
      return toAttempt(row);
    });
  }

  return {
    insertOrGetExisting(content) {
      const now = currentTimestamp();
      const contentHash = hashContent(content);
      const insertResult = db
        .insert(feedback)
        .values({
          id: randomUUID(), content, contentHash, status: feedbackStatusSchema.enum.RECEIVED,
          lastError: null, createdAt: now, updatedAt: now,
        })
        .onConflictDoNothing({ target: feedback.contentHash })
        .run();
      return { feedback: findByHash(contentHash), created: insertResult.changes === 1 };
    },

    transition,

    findById(id) {
      const row = db.select().from(feedback).where(eq(feedback.id, id)).get();
      return row ? toFeedback(row) : null;
    },

    getDetail(id) {
      const [view] = selectViews(eq(feedback.id, id), 1, 0);
      if (!view) {
        return null;
      }
      const attemptRows = db
        .select()
        .from(analysisAttempts)
        .where(eq(analysisAttempts.feedbackId, id))
        .orderBy(asc(analysisAttempts.attemptNumber))
        .all();
      return { ...view, attempts: attemptRows.map(toAttempt) };
    },

    list({ status, limit, offset }) {
      const where = status ? eq(feedback.status, status) : undefined;
      return selectViews(where, limit, offset);
    },

    recordAttempt,

    completeAnalysis(input) {
      return db.transaction(() => {
        const completed = transition(input.feedbackId, feedbackStatusSchema.enum.ANALYZING,
          feedbackStatusSchema.enum.DONE, { lastError: null });
        if (!completed) {
          return { attempt: null, completed: false };
        }
        const attempt = recordAttempt({ ...input, error: null });
        return { attempt, completed: true };
      });
    },

    resetInterruptedAnalyses() {
      const updateResult = db
        .update(feedback)
        .set({ status: feedbackStatusSchema.enum.RECEIVED, updatedAt: currentTimestamp() })
        .where(eq(feedback.status, feedbackStatusSchema.enum.ANALYZING))
        .run();
      return updateResult.changes;
    },

    listIdsByStatus(status) {
      const rows = db
        .select({ id: feedback.id })
        .from(feedback)
        .where(eq(feedback.status, status))
        .orderBy(asc(feedback.createdAt), asc(insertionOrder))
        .all();
      return rows.map((row) => row.id);
    },
  };
}

function toFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    content: row.content,
    contentHash: row.contentHash,
    status: row.status,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAttempt(row: AttemptRow): AnalysisAttempt {
  return {
    id: row.id,
    feedbackId: row.feedbackId,
    attemptNumber: row.attemptNumber,
    rawResponse: row.rawResponse,
    result: parseResult(row.resultJson),
    error: row.error,
    createdAt: row.createdAt,
  };
}

function parseResult(resultJson: string | null): AnalysisResult | null {
  if (resultJson === null) {
    return null;
  }
  // Parsing boundary: result_json is only written after the worker validated it with analysisResultSchema.
  return JSON.parse(resultJson) as AnalysisResult;
}

function currentTimestamp(): string {
  return new Date().toISOString();
}
