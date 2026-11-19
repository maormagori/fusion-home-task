import { analyzeOnce, type AttemptOutcome } from '../analysis/analyzer.js';
import type { LlmClient } from '../analysis/llm-client.js';
import { buildCorrectionMessages, buildInitialMessages } from '../analysis/prompt.js';
import { feedbackStatusSchema, type AnalysisAttempt } from '../domain/types.js';
import type { FeedbackRepository } from '../feedback/feedback.repository.js';
import type { Logger } from '../logger.js';

export interface AnalysisWorkerDeps {
  repo: FeedbackRepository;
  llm: LlmClient;
  maxAttempts: number;
  logger: Logger;
}

const { RECEIVED, ANALYZING, DONE, FAILED } = feedbackStatusSchema.enum;

export async function processFeedback(feedbackId: string, deps: AnalysisWorkerDeps): Promise<void> {
  const { repo, logger } = deps;

  const wasClaimed = repo.transition(feedbackId, RECEIVED, ANALYZING);
  if (!wasClaimed) {
    return;
  }
  logger.info({ feedbackId }, 'Feedback claimed for analysis');

  // Without this, an unexpected error would leave the item in ANALYZING until the next restart.
  try {
    await analyzeClaimedFeedback(feedbackId, deps);
  } catch (error) {
    logger.error({ feedbackId, err: error }, 'Analysis failed unexpectedly');
    const lastError = `Unexpected error during analysis: ${errorMessage(error)}`;
    repo.transition(feedbackId, ANALYZING, FAILED, { lastError });
  }
}

async function analyzeClaimedFeedback(feedbackId: string, deps: AnalysisWorkerDeps): Promise<void> {
  const { repo, llm, maxAttempts, logger } = deps;
  const feedback = repo.findById(feedbackId);
  if (!feedback) {
    throw new Error(`Feedback ${feedbackId} not found after it was claimed`);
  }

  const messages = buildInitialMessages(feedback.content);
  let latestError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await analyzeOnce(llm, messages);
    const { attemptNumber } = recordOutcome(repo, feedbackId, outcome);

    switch (outcome.kind) {
      case 'success':
        repo.transition(feedbackId, ANALYZING, DONE, { lastError: null });
        logger.info({ feedbackId, attemptNumber }, 'Feedback analysis done');
        return;
      case 'invalid_output':
        messages.push(...buildCorrectionMessages(outcome.raw, outcome.error));
        latestError = outcome.error;
        break;
      case 'llm_error':
        // The SDK already retried transport errors with backoff, so the next attempt resends the same messages.
        latestError = outcome.error;
        break;
    }

    if (attempt < maxAttempts) {
      logger.warn({ feedbackId, attemptNumber, kind: outcome.kind, error: latestError }, 'Analysis attempt failed, retrying');
    }
  }

  repo.transition(feedbackId, ANALYZING, FAILED, { lastError: latestError });
  logger.info({ feedbackId, maxAttempts, lastError: latestError }, 'Feedback analysis failed after all attempts');
}

function recordOutcome(repo: FeedbackRepository, feedbackId: string, outcome: AttemptOutcome): AnalysisAttempt {
  switch (outcome.kind) {
    case 'success':
      return repo.recordAttempt({ feedbackId, rawResponse: outcome.raw, result: outcome.result, error: null });
    case 'invalid_output':
      return repo.recordAttempt({ feedbackId, rawResponse: outcome.raw, result: null, error: outcome.error });
    case 'llm_error':
      return repo.recordAttempt({ feedbackId, rawResponse: null, result: null, error: outcome.error });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
