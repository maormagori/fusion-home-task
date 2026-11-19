import type { JSX } from 'react';
import {
  DEFAULT_LIST_LIMIT,
  FEEDBACK_STATUSES,
  feedbackStatusSchema,
  type FeedbackStatus,
  type FeedbackView,
} from '../models.js';
import { formatTimestamp } from '../format.js';
import { StatusBadge } from './StatusBadge.js';

const ALL_STATUSES_VALUE = '';

interface FeedbackListProps {
  items: FeedbackView[] | null;
  error: string | null;
  selectedId: string | null;
  highlightedId: string | null;
  statusFilter: FeedbackStatus | undefined;
  offset: number;
  onSelect: (feedbackId: string) => void;
  onStatusFilterChange: (status: FeedbackStatus | undefined) => void;
  onOffsetChange: (offset: number) => void;
}

export function FeedbackList(props: FeedbackListProps): JSX.Element {
  function handleFilterChange(value: string): void {
    props.onStatusFilterChange(value === ALL_STATUSES_VALUE ? undefined : feedbackStatusSchema.parse(value));
  }

  return (
    <section className="panel" aria-labelledby="list-heading">
      <div className="panel-header">
        <h2 id="list-heading">Feedback</h2>
        <label className="inline-label">
          Status
          <select value={props.statusFilter ?? ALL_STATUSES_VALUE} onChange={(event) => handleFilterChange(event.target.value)}>
            <option value={ALL_STATUSES_VALUE}>All</option>
            {FEEDBACK_STATUSES.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
      </div>
      {props.error && <p className="notice" data-kind="error" role="alert">Could not load feedback: {props.error}</p>}
      <FeedbackRows {...props} />
      <Pager
        offset={props.offset}
        visibleCount={props.items?.length ?? 0}
        onOffsetChange={props.onOffsetChange}
      />
    </section>
  );
}

function FeedbackRows({ items, selectedId, highlightedId, onSelect }: FeedbackListProps): JSX.Element {
  if (items === null) {
    return <p className="muted">Loading feedback…</p>;
  }
  if (items.length === 0) {
    return <p className="empty-state">No feedback here yet. Submit some above to see it analyzed.</p>;
  }
  return (
    <ul className="feedback-rows">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="feedback-row"
            aria-current={item.id === selectedId}
            data-highlighted={item.id === highlightedId}
            onClick={() => onSelect(item.id)}
          >
            <span className="feedback-preview">{item.content}</span>
            <span className="feedback-meta">
              <StatusBadge status={item.status} />
              <span className="muted">{formatTimestamp(item.createdAt)}</span>
              <span className="muted">{item.attemptCount} {item.attemptCount === 1 ? 'attempt' : 'attempts'}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface PagerProps {
  offset: number;
  visibleCount: number;
  onOffsetChange: (offset: number) => void;
}

function Pager({ offset, visibleCount, onOffsetChange }: PagerProps): JSX.Element {
  const hasPreviousPage = offset > 0;
  const hasNextPage = visibleCount === DEFAULT_LIST_LIMIT;
  return (
    <nav className="pager" aria-label="Feedback pages">
      <button type="button" disabled={!hasPreviousPage} onClick={() => onOffsetChange(Math.max(0, offset - DEFAULT_LIST_LIMIT))}>
        Previous
      </button>
      <span className="muted">
        {visibleCount === 0 ? 'No items' : `Items ${offset + 1}–${offset + visibleCount}`}
      </span>
      <button type="button" disabled={!hasNextPage} onClick={() => onOffsetChange(offset + DEFAULT_LIST_LIMIT)}>
        Next
      </button>
    </nav>
  );
}
