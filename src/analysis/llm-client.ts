import OpenAI from 'openai';
import { z } from 'zod';
import type { Config } from '../config.js';
import { analysisResultSchema } from './analysis.schema.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface LlmClient {
  complete(messages: ChatMessage[]): Promise<string>;
}

const RESPONSE_SCHEMA_NAME = 'feedback_analysis';

export function createOpenAiLlmClient(config: Config): LlmClient {
  const openai = new OpenAI({
    baseURL: config.LLM_BASE_URL,
    apiKey: config.LLM_API_KEY,
    timeout: config.LLM_TIMEOUT_MS,
    maxRetries: config.LLM_SDK_MAX_RETRIES,
  });
  const responseSchema = z.toJSONSchema(analysisResultSchema);

  return {
    async complete(messages: ChatMessage[]): Promise<string> {
      const completion = await openai.chat.completions.create({
        model: config.LLM_MODEL,
        messages,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: { name: RESPONSE_SCHEMA_NAME, strict: true, schema: responseSchema },
        },
      });
      const content = completion.choices[0]?.message.content;
      if (!content) {
        throw new Error(`LLM returned an empty response (model ${config.LLM_MODEL})`);
      }
      return content;
    },
  };
}
