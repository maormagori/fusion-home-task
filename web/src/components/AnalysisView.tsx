import type { JSX } from 'react';
import type { AnalysisResult } from '../models.js';
import { formatConfidence } from '../format.js';

export function AnalysisView({ analysis }: { analysis: AnalysisResult }): JSX.Element {
  return (
    <div className="analysis">
      <div className="field">
        <h3>Sentiment</h3>
        <span className="sentiment" data-sentiment={analysis.sentiment}>{analysis.sentiment}</span>
      </div>
      <div className="field">
        <h3>Feature requests</h3>
        {analysis.feature_requests.length === 0 ? (
          <p className="muted">No feature requests found.</p>
        ) : (
          <ul className="feature-requests">
            {analysis.feature_requests.map((request) => (
              <li key={request.title}>
                <span>{request.title}</span>
                <span className="confidence">
                  <span className="confidence-bar" aria-hidden="true">
                    <span style={{ width: formatConfidence(request.confidence) }} />
                  </span>
                  <span className="tabular">{formatConfidence(request.confidence)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="field">
        <h3>Actionable insight</h3>
        <p>{analysis.actionable_insight}</p>
      </div>
    </div>
  );
}
