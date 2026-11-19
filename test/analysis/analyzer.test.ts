import { describe, expect, it } from 'vitest';
import { analyzeOnce, validateRawOutput } from '../../src/analysis/analyzer.js';
import { createOpenAiLlmClient } from '../../src/analysis/llm-client.js';
import { buildInitialMessages } from '../../src/analysis/prompt.js';
import { loadConfig } from '../../src/config.js';

const validResult = {
  sentiment: 'negative',
  feature_requests: [{ title: 'Offline mode', confidence: 0.9 }],
  actionable_insight: 'Fix the crash on startup.',
};

function rawWith(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...validResult, ...overrides });
}

function validationErrorFor(raw: string): string {
  const validation = validateRawOutput(raw);
  if (validation.ok) {
    throw new Error(`Expected validation to fail for: ${raw}`);
  }
  return validation.error;
}

describe('validateRawOutput', () => {
  it('accepts valid JSON that matches the schema', () => {
    expect(validateRawOutput(JSON.stringify(validResult))).toEqual({ ok: true, result: validResult });
  });

  it('accepts an empty feature_requests list', () => {
    expect(validateRawOutput(rawWith({ feature_requests: [] })).ok).toBe(true);
  });

  it('rejects text that is not JSON', () => {
    expect(validationErrorFor('The sentiment is negative.')).toMatch(/^Response is not valid JSON: /);
  });

  it('rejects JSON wrapped in markdown fences instead of stripping them', () => {
    const fenced = '```json\n' + JSON.stringify(validResult) + '\n```';
    expect(validationErrorFor(fenced)).toMatch(/^Response is not valid JSON: /);
  });

  it('rejects a missing key and names it', () => {
    const { actionable_insight: _omitted, ...withoutInsight } = validResult;
    expect(validationErrorFor(JSON.stringify(withoutInsight))).toContain('actionable_insight');
  });

  it('rejects an extra key', () => {
    expect(validationErrorFor(rawWith({ summary: 'extra' }))).toContain('summary');
  });

  it('rejects an unknown sentiment', () => {
    expect(validationErrorFor(rawWith({ sentiment: 'angry' }))).toContain('sentiment');
  });

  it('rejects a confidence above 1', () => {
    expect(validationErrorFor(rawWith({ feature_requests: [{ title: 'Offline mode', confidence: 1.5 }] }))).toContain('confidence');
  });

  it('rejects an empty feature request title', () => {
    expect(validationErrorFor(rawWith({ feature_requests: [{ title: '', confidence: 0.5 }] }))).toContain('title');
  });
});

describe('analyzeOnce', () => {
  it('returns llm_error when the LLM cannot be reached', async () => {
    const unreachableConfig = loadConfig({ LLM_BASE_URL: 'http://127.0.0.1:9/v1', LLM_SDK_MAX_RETRIES: '0' });
    const llm = createOpenAiLlmClient(unreachableConfig);

    const outcome = await analyzeOnce(llm, buildInitialMessages('The app crashes.'));

    expect(outcome.kind).toBe('llm_error');
  });
});
