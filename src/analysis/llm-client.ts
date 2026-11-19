import OpenAI from 'openai';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import type { Config } from '../config.js';
import { analysisResultSchema } from './analysis.schema.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export class LlmCallError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

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
      try {
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
        if (content === null || content === undefined) {
          throw new Error(`LLM returned no response content (model ${config.LLM_MODEL})`);
        }
        return content;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LlmCallError(message, isRetryable(error));
      }
    },
  };
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError) || error.status === undefined) {
    return true;
  }
  return error.status === StatusCodes.REQUEST_TIMEOUT
    || error.status === StatusCodes.CONFLICT
    || error.status === StatusCodes.TOO_MANY_REQUESTS
    || error.status >= StatusCodes.INTERNAL_SERVER_ERROR;
}
