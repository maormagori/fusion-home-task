import { analyzeOnce, type AttemptOutcome } from '../analysis/analyzer.js';
import type { LlmClient } from '../analysis/llm-client.js';
import { buildCorrectionMessages, buildInitialMessages } from '../analysis/prompt.js';
import type { FeedbackRepository } from '../feedback/feedback.repository.js';

export interface AnalysisWorkerDeps {
  repo: FeedbackRepository;
  llm: LlmClient;
  maxAttempts: number;
}

export async function processFeedback(feedbackId: string, deps: AnalysisWorkerDeps): Promise<void> {
  const { repo, llm, maxAttempts } = deps;

  const wasClaimed = repo.transition(feedbackId, 'RECEIVED', 'ANALYZING');
  if (!wasClaimed) {
    return;
  }
  const feedback = repo.findById(feedbackId);
  if (!feedback) {
    throw new Error(`Feedback ${feedbackId} not found after it was claimed`);
  }

  const messages = buildInitialMessages(feedback.content);
  let latestError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await analyzeOnce(llm, messages);
    recordOutcome(repo, feedbackId, outcome);

    switch (outcome.kind) {
      case 'success':
        repo.transition(feedbackId, 'ANALYZING', 'DONE', { lastError: null });
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
  }

  repo.transition(feedbackId, 'ANALYZING', 'FAILED', { lastError: latestError });
}

function recordOutcome(repo: FeedbackRepository, feedbackId: string, outcome: AttemptOutcome): void {
  switch (outcome.kind) {
    case 'success':
      repo.recordAttempt({ feedbackId, rawResponse: outcome.raw, result: outcome.result, error: null });
      return;
    case 'invalid_output':
      repo.recordAttempt({ feedbackId, rawResponse: outcome.raw, result: null, error: outcome.error });
      return;
    case 'llm_error':
      repo.recordAttempt({ feedbackId, rawResponse: null, result: null, error: outcome.error });
      return;
  }
}
