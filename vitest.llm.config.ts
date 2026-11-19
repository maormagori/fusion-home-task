import { defineConfig } from 'vitest/config';

const LLM_TEST_TIMEOUT_MS = 120_000;

export default defineConfig({
  test: {
    include: ['test/**/*.llm.test.ts'],
    testTimeout: LLM_TEST_TIMEOUT_MS,
  },
});
