// Reads and validates environment variables once at startup. Defaults match docs/ARCHITECTURE.md §7.
import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().min(1).default('./data/feedback.db'),
  LLM_BASE_URL: z.url().default('http://localhost:11434/v1'),
  LLM_API_KEY: z.string().min(1).default('ollama'),
  LLM_MODEL: z.string().min(1).default('qwen2.5:7b-instruct'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LLM_SDK_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  ANALYSIS_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MAX_CONTENT_LENGTH: z.coerce.number().int().positive().default(5000),
});

export type Config = z.infer<typeof configSchema>;

// Throws a ZodError naming every invalid variable, so a bad env stops the server before it starts.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return configSchema.parse(env);
}
