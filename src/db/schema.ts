import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { FEEDBACK_STATUSES } from '../domain/types.js';

// Built from FEEDBACK_STATUSES so the CHECK constraint and the TypeScript type cannot drift apart.
const allowedStatusesSql = sql.raw(FEEDBACK_STATUSES.map((status) => `'${status}'`).join(', '));

export const feedback = sqliteTable(
  'feedback',
  {
    id: text('id').primaryKey(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    status: text('status', { enum: FEEDBACK_STATUSES }).notNull(),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('feedback_content_hash_unique').on(table.contentHash),
    index('feedback_status_idx').on(table.status),
    check('feedback_status_check', sql`${table.status} IN (${allowedStatusesSql})`),
  ],
);

export const analysisAttempts = sqliteTable(
  'analysis_attempts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    feedbackId: text('feedback_id').notNull().references(() => feedback.id),
    attemptNumber: integer('attempt_number').notNull(),
    rawResponse: text('raw_response'),
    // Validated AnalysisResult as JSON text; the repository parses it on read.
    resultJson: text('result_json'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('analysis_attempts_feedback_attempt_unique').on(table.feedbackId, table.attemptNumber),
  ],
);
