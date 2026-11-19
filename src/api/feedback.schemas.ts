import { z } from 'zod';
import { analysisResultSchema } from '../analysis/analysis.schema.js';
import {
  FEEDBACK_STATUSES,
  type AnalysisAttempt,
  type FeedbackDetail,
  type FeedbackView,
} from '../domain/types.js';

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

export const feedbackStatusSchema = z.enum(FEEDBACK_STATUSES);

// The max length is a server setting (MAX_CONTENT_LENGTH), so the body schema is built from it.
export function createSubmitFeedbackBodySchema(
  maxContentLength: number,
): z.ZodObject<{ content: z.ZodString }> {
  return z.object({
    content: z.string().trim().min(1).max(maxContentLength),
  });
}
export type SubmitFeedbackBody = z.infer<ReturnType<typeof createSubmitFeedbackBodySchema>>;

export const listFeedbackQuerySchema = z.object({
  status: feedbackStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListFeedbackQuery = z.infer<typeof listFeedbackQuerySchema>;

export const feedbackIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const submitFeedbackResponseSchema = z.object({
  id: z.string(),
  status: feedbackStatusSchema,
  duplicate: z.boolean(),
});
export type SubmitFeedbackResponse = z.infer<typeof submitFeedbackResponseSchema>;

export const feedbackViewSchema = z.object({
  id: z.string(),
  content: z.string(),
  contentHash: z.string(),
  status: feedbackStatusSchema,
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  attemptCount: z.number().int(),
  analysis: analysisResultSchema.nullable(),
}) satisfies z.ZodType<FeedbackView>;

export const analysisAttemptSchema = z.object({
  id: z.number().int(),
  feedbackId: z.string(),
  attemptNumber: z.number().int(),
  rawResponse: z.string().nullable(),
  result: analysisResultSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
}) satisfies z.ZodType<AnalysisAttempt>;

export const feedbackDetailSchema = feedbackViewSchema.extend({
  attempts: z.array(analysisAttemptSchema),
}) satisfies z.ZodType<FeedbackDetail>;

export const feedbackListResponseSchema = z.object({
  items: z.array(feedbackViewSchema),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type FeedbackListResponse = z.infer<typeof feedbackListResponseSchema>;

export const retryFeedbackResponseSchema = z.object({
  id: z.string(),
  status: z.literal('RECEIVED'),
});
export type RetryFeedbackResponse = z.infer<typeof retryFeedbackResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.string(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const retryConflictResponseSchema = errorResponseSchema.extend({
  status: feedbackStatusSchema,
});
export type RetryConflictResponse = z.infer<typeof retryConflictResponseSchema>;
