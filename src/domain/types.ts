import type { AnalysisResult } from '../analysis/analysis.schema.js';

export const FEEDBACK_STATUSES = ['RECEIVED', 'ANALYZING', 'DONE', 'FAILED'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface Feedback {
  id: string;                 // uuid
  content: string;
  contentHash: string;
  status: FeedbackStatus;
  lastError: string | null;
  createdAt: string;          // ISO 8601
  updatedAt: string;
}

export interface AnalysisAttempt {
  id: number;
  feedbackId: string;
  attemptNumber: number;      // 1, 2, 3… across the item's whole lifetime
  rawResponse: string | null; // null only when the LLM call itself failed
  result: AnalysisResult | null; // set only when validation passed
  error: string | null;
  createdAt: string;
}

export interface FeedbackView extends Feedback {
  attemptCount: number;
  analysis: AnalysisResult | null; // non-null only when status === 'DONE'
}

export interface FeedbackDetail extends FeedbackView {
  attempts: AnalysisAttempt[];     // ordered by attemptNumber
}
