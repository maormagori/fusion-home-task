import { useState, type JSX } from 'react';
import type { FeedbackStatus, FeedbackView, SubmitFeedbackResponse } from './models.js';
import { FeedbackDetailPanel } from './components/FeedbackDetailPanel.js';
import { FeedbackList } from './components/FeedbackList.js';
import { SubmitForm } from './components/SubmitForm.js';
import { isAnalysisInProgress, useFeedbackList } from './useFeedbackList.js';

export function App(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | undefined>(undefined);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const list = useFeedbackList(statusFilter, offset);

  function handleSubmitted(response: SubmitFeedbackResponse): void {
    setSelectedId(response.id);
    setSubmittedId(response.id);
    setHighlightedId(response.duplicate ? response.id : null);
    void list.reload();
  }

  function handleSelect(feedbackId: string): void {
    setSelectedId(feedbackId);
    setHighlightedId(null);
  }

  function handleStatusFilterChange(status: FeedbackStatus | undefined): void {
    setStatusFilter(status);
    setOffset(0);
  }

  const selectedItem = list.items?.find((item) => item.id === selectedId);
  // Until the list shows the submitted item, assume its analysis is still running so the notice does not flicker.
  const submittedItem = list.items?.find((item) => item.id === submittedId);
  const isSubmittedItemAnalyzing = submittedItem ? isAnalysisInProgress(submittedItem.status) : true;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Feedback Insights</h1>
        <p className="muted">Submit feedback and follow its analysis from RECEIVED to DONE or FAILED.</p>
      </header>
      <main className="layout">
        <div className="column">
          <SubmitForm isSubmittedItemAnalyzing={isSubmittedItemAnalyzing} onSubmitted={handleSubmitted} />
          <FeedbackList
            items={list.items}
            error={list.error}
            selectedId={selectedId}
            highlightedId={highlightedId}
            statusFilter={statusFilter}
            offset={offset}
            onSelect={handleSelect}
            onStatusFilterChange={handleStatusFilterChange}
            onOffsetChange={setOffset}
          />
        </div>
        <div className="column">
          {selectedId ? (
            <FeedbackDetailPanel
              key={selectedId}
              feedbackId={selectedId}
              refreshKey={buildRefreshKey(selectedItem)}
              onRetried={() => void list.reload()}
            />
          ) : (
            <section className="panel empty-state" aria-label="Feedback detail">
              <p>Select a feedback item to see its analysis and attempts.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function buildRefreshKey(item: FeedbackView | undefined): string {
  if (!item) {
    return '';
  }
  return `${item.status}:${item.attemptCount}:${item.updatedAt}`;
}
