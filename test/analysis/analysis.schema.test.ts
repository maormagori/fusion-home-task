import { describe, expect, it } from 'vitest';
import { analysisResultSchema, sentimentSchema } from '../../src/analysis/analysis.schema.js';

const validSample = {
  sentiment: sentimentSchema.enum.negative,
  feature_requests: [{ title: 'Dark mode', confidence: 0.9 }],
  actionable_insight: 'Users want a dark theme for night use.',
};

describe('analysisResultSchema', () => {
  it('accepts a valid sample', () => {
    expect(analysisResultSchema.safeParse(validSample).success).toBe(true);
  });

  it('accepts an empty feature_requests list', () => {
    const sample = { ...validSample, feature_requests: [] };
    expect(analysisResultSchema.safeParse(sample).success).toBe(true);
  });

  it('rejects an extra top-level key', () => {
    const sample = { ...validSample, summary: 'extra' };
    expect(analysisResultSchema.safeParse(sample).success).toBe(false);
  });

  it('rejects an extra key inside a feature request', () => {
    const sample = { ...validSample, feature_requests: [{ title: 'Dark mode', confidence: 0.9, priority: 1 }] };
    expect(analysisResultSchema.safeParse(sample).success).toBe(false);
  });

  it('rejects a confidence above 1', () => {
    const sample = { ...validSample, feature_requests: [{ title: 'Dark mode', confidence: 1.5 }] };
    expect(analysisResultSchema.safeParse(sample).success).toBe(false);
  });

  it('rejects an unknown sentiment', () => {
    const sample = { ...validSample, sentiment: 'angry' };
    expect(analysisResultSchema.safeParse(sample).success).toBe(false);
  });
});
