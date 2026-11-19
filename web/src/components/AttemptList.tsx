import type { JSX } from 'react';
import type { AnalysisAttempt } from '../models.js';
import { formatTimestamp } from '../format.js';

export function AttemptList({ attempts }: { attempts: AnalysisAttempt[] }): JSX.Element {
  return (
    <details className="attempts">
      <summary>Attempts ({attempts.length})</summary>
      {attempts.length === 0 && <p className="muted">No attempts yet.</p>}
      <ol>
        {attempts.map((attempt) => (
          <li key={attempt.id} className="attempt">
            <div className="attempt-header">
              <strong>Attempt {attempt.attemptNumber}</strong>
              <span className="attempt-outcome" data-valid={attempt.result !== null}>
                {describeOutcome(attempt)}
              </span>
              <span className="muted">{formatTimestamp(attempt.createdAt)}</span>
            </div>
            {attempt.error && <p className="attempt-error">{attempt.error}</p>}
            {attempt.rawResponse !== null && <pre>{attempt.rawResponse}</pre>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function describeOutcome(attempt: AnalysisAttempt): string {
  if (attempt.result !== null) {
    return 'valid output';
  }
  return attempt.rawResponse === null ? 'LLM call failed' : 'invalid output';
}
