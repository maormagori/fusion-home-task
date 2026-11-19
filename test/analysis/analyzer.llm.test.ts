import { describe, expect, it } from 'vitest';
import { analyzeOnce } from '../../src/analysis/analyzer.js';
import { createOpenAiLlmClient } from '../../src/analysis/llm-client.js';
import { buildInitialMessages } from '../../src/analysis/prompt.js';
import { createTestConfig } from '../helpers/test-config.js';

describe('analyzeOnce with the real local model', () => {
  it('finds negative sentiment and a feature request in angry feedback', async () => {
    const llm = createOpenAiLlmClient(createTestConfig());
    const feedback = 'The app crashes every time I open it on the train. This is unusable. Please add an offline mode.';

    const outcome = await analyzeOnce(llm, buildInitialMessages(feedback));

    if (outcome.kind !== 'success') {
      throw new Error(`Expected success, got ${outcome.kind}: ${outcome.error}`);
    }
    expect(outcome.result.sentiment).toBe('negative');
    expect(outcome.result.feature_requests.length).toBeGreaterThan(0);
  });
});
