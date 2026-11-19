import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { analysisResultSchema, sentimentSchema } from '@feedback/shared/analysis';

const validSample = {
  sentiment: sentimentSchema.enum.negative,
  feature_requests: [{ title: 'Dark mode', confidence: 0.9 }],
  actionable_insight: 'Users want a dark theme for night use.',
};

describe('analysisResultSchema', () => {
  it('accepts a valid sample', () => {
    expect(analysisResultSchema.safeParse(validSample).success).toBe(true);
  });

  it.each(['', '   ', '\n\t '])('rejects a blank feature title: %j', (title) => {
    const sample = { ...validSample, feature_requests: [{ title, confidence: 0.9 }] };
    expect(analysisResultSchema.safeParse(sample).success).toBe(false);
  });

  it.each(['', '   ', '\n\t '])('rejects a blank insight: %j', (actionable_insight) => {
    expect(analysisResultSchema.safeParse({ ...validSample, actionable_insight }).success).toBe(false);
  });

  it('trims valid titles and insights', () => {
    const raw = JSON.stringify({ ...validSample,
      feature_requests: [{ title: '  Dark mode \n', confidence: 0.9 }],
      actionable_insight: ' Users want a dark theme for night use.\t ',
    });
    expect(analysisResultSchema.parse(JSON.parse(raw))).toEqual(validSample);
  });

  it('still produces a JSON schema for structured output', () => {
    expect(z.toJSONSchema(analysisResultSchema)).toMatchObject({
      properties: { actionable_insight: { type: 'string', minLength: 1 } },
    });
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
