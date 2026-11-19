import type { z } from 'zod';
import {
  CONFIG_PATH,
  FEEDBACK_PATH,
  configResponseSchema,
  errorResponseSchema,
  feedbackDetailUrl,
  feedbackListResponseSchema,
  feedbackRetryUrl,
  retryFeedbackResponseSchema,
  submitFeedbackResponseSchema,
  feedbackDetailSchema,
  type ConfigResponse,
  type FeedbackDetail,
  type FeedbackListResponse,
  type ListFeedbackQuery,
  type RetryFeedbackResponse,
  type SubmitFeedbackBody,
  type SubmitFeedbackResponse,
} from './models.js';

export function getConfig(): Promise<ConfigResponse> {
  return requestJson(CONFIG_PATH, { method: 'GET' }, configResponseSchema);
}

export function submitFeedback(body: SubmitFeedbackBody): Promise<SubmitFeedbackResponse> {
  return requestJson(FEEDBACK_PATH, jsonPost(body), submitFeedbackResponseSchema);
}

export function listFeedback(query: ListFeedbackQuery): Promise<FeedbackListResponse> {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
  if (query.status) {
    params.set('status', query.status);
  }
  return requestJson(`${FEEDBACK_PATH}?${params}`, { method: 'GET' }, feedbackListResponseSchema);
}

export function getFeedbackDetail(feedbackId: string): Promise<FeedbackDetail> {
  return requestJson(feedbackDetailUrl(feedbackId), { method: 'GET' }, feedbackDetailSchema);
}

export function retryFeedback(feedbackId: string): Promise<RetryFeedbackResponse> {
  return requestJson(feedbackRetryUrl(feedbackId), { method: 'POST' }, retryFeedbackResponseSchema);
}

// Responses are parsed with the backend's own schemas, so a contract drift shows up as an error, not as bad data.
async function requestJson<Schema extends z.ZodType>(
  url: string,
  init: RequestInit,
  responseSchema: Schema,
): Promise<z.infer<Schema>> {
  const response = await fetch(url, init);
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(errorResponseSchema.parse(body).error);
  }
  return responseSchema.parse(body);
}

function jsonPost(body: SubmitFeedbackBody): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
