import { z } from 'zod';
import { analysisResultSchema } from '@feedback/shared/analysis';

export const FEEDBACK_STATUSES = ['RECEIVED', 'ANALYZING', 'DONE', 'FAILED'] as const;
export const feedbackStatusSchema = z.enum(FEEDBACK_STATUSES);
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;

export const feedbackSchema = z.object({
  id: z.string(),
  content: z.string(),
  contentHash: z.string(),
  status: feedbackStatusSchema,
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

export const analysisAttemptSchema = z.object({
  id: z.number().int(),
  feedbackId: z.string(),
  attemptNumber: z.number().int(),
  rawResponse: z.string().nullable(),
  result: analysisResultSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type AnalysisAttempt = z.infer<typeof analysisAttemptSchema>;

export const feedbackViewSchema = feedbackSchema.extend({
  attemptCount: z.number().int(),
  analysis: analysisResultSchema.nullable(),
});
export type FeedbackView = z.infer<typeof feedbackViewSchema>;

export const feedbackDetailSchema = feedbackViewSchema.extend({
  attempts: z.array(analysisAttemptSchema),
});
export type FeedbackDetail = z.infer<typeof feedbackDetailSchema>;
