// Unit and DB tests. LLM tests (*.llm.test.ts) need a running Ollama and live in vitest.llm.config.ts.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.llm.test.ts', 'node_modules/**'],
  },
});
