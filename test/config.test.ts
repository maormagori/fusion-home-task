import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns the documented defaults for an empty env', () => {
    expect(loadConfig({})).toEqual({
      LOG_LEVEL: 'info',
      PORT: 3000,
      DB_PATH: './data/feedback.db',
      LLM_BASE_URL: 'http://localhost:11434/v1',
      LLM_API_KEY: 'ollama',
      LLM_MODEL: 'qwen2.5:7b-instruct',
      LLM_TIMEOUT_MS: 60000,
      LLM_SDK_MAX_RETRIES: 2,
      MAX_ATTEMPTS: 3,
      ANALYSIS_CONCURRENCY: 2,
      MAX_CONTENT_LENGTH: 5000,
    });
  });

  it('turns numeric strings into numbers', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('throws on a non-numeric PORT', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
  });
});
