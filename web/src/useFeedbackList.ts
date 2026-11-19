import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LIST_LIMIT, feedbackStatusSchema, type FeedbackStatus, type FeedbackView } from './models.js';
import { listFeedback } from './api.js';
import { describeError } from './format.js';

const POLL_INTERVAL_MS = 2000;
const IN_PROGRESS_STATUSES: readonly FeedbackStatus[] = [
  feedbackStatusSchema.enum.RECEIVED,
  feedbackStatusSchema.enum.ANALYZING,
];

export interface FeedbackListState {
  items: FeedbackView[] | null;
  error: string | null;
  reload: () => Promise<void>;
}

export function useFeedbackList(statusFilter: FeedbackStatus | undefined, offset: number): FeedbackListState {
  const [items, setItems] = useState<FeedbackView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const page = await listFeedback({ status: statusFilter, limit: DEFAULT_LIST_LIMIT, offset });
      setItems(page.items);
      setError(null);
    } catch (loadError) {
      setError(describeError(loadError));
    }
  }, [statusFilter, offset]);

  useEffect(() => {
    setItems(null);
    void reload();
  }, [reload]);

  const isAnyItemInProgress = items?.some((item) => IN_PROGRESS_STATUSES.includes(item.status)) ?? false;
  useEffect(() => {
    if (!isAnyItemInProgress) {
      return;
    }
    const timer = setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isAnyItemInProgress, reload]);

  return { items, error, reload };
}
