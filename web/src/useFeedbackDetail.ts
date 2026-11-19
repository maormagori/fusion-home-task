import { useCallback, useEffect, useState } from 'react';
import type { FeedbackDetail } from './models.js';
import { getFeedbackDetail } from './api.js';
import { describeError } from './format.js';

export interface FeedbackDetailState {
  detail: FeedbackDetail | null;
  error: string | null;
  reload: () => Promise<void>;
}

// refreshKey changes whenever the list sees the item change, so the open detail follows the polling.
export function useFeedbackDetail(feedbackId: string, refreshKey: string): FeedbackDetailState {
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDetail(await getFeedbackDetail(feedbackId));
      setError(null);
    } catch (loadError) {
      setError(describeError(loadError));
    }
  }, [feedbackId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  return { detail, error, reload };
}
