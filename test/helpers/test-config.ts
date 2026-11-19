import { loadConfig, type Config } from '../../src/config.js';

export const TEST_HOST = '127.0.0.1';
// Nothing listens on the discard port (9), so calls fail fast with "connection refused".
const DEFAULT_UNREACHABLE_LLM_BASE_URL = `http://${TEST_HOST}:9/v1`;

export function createTestConfig(overrides: NodeJS.ProcessEnv = {}): Config {
  return loadConfig({ ...process.env, ...overrides });
}

export function createUnreachableLlmTestConfig(): Config {
  return createTestConfig({
    LLM_BASE_URL: process.env.TEST_UNREACHABLE_LLM_BASE_URL ?? DEFAULT_UNREACHABLE_LLM_BASE_URL,
    LLM_SDK_MAX_RETRIES: '0',
  });
}
