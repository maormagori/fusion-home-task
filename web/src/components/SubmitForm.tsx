import { useEffect, useState, type FormEvent, type JSX } from 'react';
import type { SubmitFeedbackResponse } from '../models.js';
import { getConfig, submitFeedback } from '../api.js';
import { describeError } from '../format.js';

const SUBMITTED_MESSAGE = 'Submitted, analyzing…';
const DUPLICATE_MESSAGE = 'This feedback was already submitted';

type Notice = { kind: 'success' | 'info' | 'error'; text: string };

interface SubmitFormProps {
  isSubmittedItemAnalyzing: boolean;
  onSubmitted: (response: SubmitFeedbackResponse) => void;
}

export function SubmitForm({ isSubmittedItemAnalyzing, onSubmitted }: SubmitFormProps): JSX.Element {
  const [content, setContent] = useState('');
  const [maxContentLength, setMaxContentLength] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    getConfig()
      .then((config) => setMaxContentLength(config.maxContentLength))
      .catch((configError: unknown) => setNotice({ kind: 'error', text: describeError(configError) }));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSending(true);
    setNotice(null);
    try {
      const response = await submitFeedback({ content });
      setNotice(response.duplicate
        ? { kind: 'info', text: DUPLICATE_MESSAGE }
        : { kind: 'success', text: SUBMITTED_MESSAGE });
      setContent('');
      onSubmitted(response);
    } catch (submitError) {
      setNotice({ kind: 'error', text: describeError(submitError) });
    } finally {
      setIsSending(false);
    }
  }

  const isOverLimit = maxContentLength !== null && content.length > maxContentLength;
  const canSubmit = maxContentLength !== null && !isSending;
  const isNoticeStale = notice?.kind === 'success' && !isSubmittedItemAnalyzing;
  const visibleNotice = isNoticeStale ? null : notice;

  return (
    <section className="panel" aria-labelledby="submit-heading">
      <h2 id="submit-heading">New feedback</h2>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="feedback-content">Feedback text</label>
        <textarea
          id="feedback-content"
          value={content}
          rows={4}
          aria-describedby="feedback-counter"
          aria-invalid={isOverLimit}
          onChange={(event) => setContent(event.target.value)}
        />
        <div className="form-footer">
          <span id="feedback-counter" className={isOverLimit ? 'counter over-limit' : 'counter muted'}>
            {content.length} / {maxContentLength ?? '…'} characters
          </span>
          <button type="submit" className="button-primary" disabled={!canSubmit}>
            {isSending ? 'Sending…' : 'Submit'}
          </button>
        </div>
        <p className="notice" data-kind={visibleNotice?.kind} role="status" aria-live="polite">
          {visibleNotice?.text}
        </p>
      </form>
    </section>
  );
}
