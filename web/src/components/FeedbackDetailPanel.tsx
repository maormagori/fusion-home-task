import { useState, type JSX } from 'react';
import { feedbackStatusSchema, type FeedbackDetail } from '../models.js';
import { retryFeedback } from '../api.js';
import { describeError, formatTimestamp } from '../format.js';
import { useFeedbackDetail } from '../useFeedbackDetail.js';
import { AnalysisView } from './AnalysisView.js';
import { AttemptList } from './AttemptList.js';
import { StatusBadge } from './StatusBadge.js';

interface FeedbackDetailPanelProps {
  feedbackId: string;
  refreshKey: string;
  onRetried: () => void;
}

export function FeedbackDetailPanel({ feedbackId, refreshKey, onRetried }: FeedbackDetailPanelProps): JSX.Element {
  const { detail, error, reload } = useFeedbackDetail(feedbackId, refreshKey);

  function handleRetried(): void {
    void reload();
    onRetried();
  }

  return (
    <section className="panel" aria-labelledby="detail-heading">
      <h2 id="detail-heading">Detail</h2>
      {error && <p className="notice" data-kind="error" role="alert">Could not load this feedback: {error}</p>}
      {!detail && !error && <p className="muted">Loading detail…</p>}
      {detail && (
        <>
          <div className="detail-meta">
            <StatusBadge status={detail.status} />
            <span className="muted">Created {formatTimestamp(detail.createdAt)}</span>
          </div>
          <blockquote className="feedback-content">{detail.content}</blockquote>
          <StatusSection detail={detail} onRetried={handleRetried} />
          <AttemptList attempts={detail.attempts} />
        </>
      )}
    </section>
  );
}

function StatusSection({ detail, onRetried }: { detail: FeedbackDetail; onRetried: () => void }): JSX.Element | null {
  switch (detail.status) {
    case feedbackStatusSchema.enum.RECEIVED:
    case feedbackStatusSchema.enum.ANALYZING:
      return <p className="muted" aria-live="polite">Analysis in progress. This panel updates automatically.</p>;
    case feedbackStatusSchema.enum.DONE:
      return detail.analysis && <AnalysisView analysis={detail.analysis} />;
    case feedbackStatusSchema.enum.FAILED:
      return <FailedSection feedbackId={detail.id} lastError={detail.lastError} onRetried={onRetried} />;
  }
}

interface FailedSectionProps {
  feedbackId: string;
  lastError: string | null;
  onRetried: () => void;
}

function FailedSection({ feedbackId, lastError, onRetried }: FailedSectionProps): JSX.Element {
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function handleRetry(): Promise<void> {
    setIsRetrying(true);
    setRetryError(null);
    try {
      await retryFeedback(feedbackId);
      onRetried();
    } catch (error) {
      setRetryError(describeError(error));
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <div className="failed">
      <h3>Last error</h3>
      <p className="attempt-error">{lastError}</p>
      <button type="button" className="button-primary" disabled={isRetrying} onClick={() => void handleRetry()}>
        {isRetrying ? 'Retrying…' : 'Retry analysis'}
      </button>
      {retryError && <p className="notice" data-kind="error" role="alert">{retryError}</p>}
    </div>
  );
}
