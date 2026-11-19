// Tests that call the real local Ollama model. Run with `npm run test:llm`; not part of CI.
import { defineConfig } from 'vitest/config';

const LLM_TEST_TIMEOUT_MS = 120_000;

export default defineConfig({
  test: {
    include: ['test/**/*.llm.test.ts'],
    testTimeout: LLM_TEST_TIMEOUT_MS,
  },
});
