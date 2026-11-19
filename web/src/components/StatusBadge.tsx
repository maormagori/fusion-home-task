import type { JSX } from 'react';
import type { FeedbackStatus } from '../models.js';

export function StatusBadge({ status }: { status: FeedbackStatus }): JSX.Element {
  return (
    <span className="status-badge" data-status={status}>
      {status}
    </span>
  );
}
