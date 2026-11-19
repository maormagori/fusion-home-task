import { z } from 'zod';
import { analysisResultSchema, type AnalysisResult } from './analysis.schema.js';
import { LlmCallError, type ChatMessage, type LlmClient } from './llm-client.js';

export type AttemptOutcome =
  | { kind: 'success'; raw: string; result: AnalysisResult }
  | { kind: 'invalid_output'; raw: string; error: string }
  | { kind: 'llm_error'; error: string; retryable: boolean };

export async function analyzeOnce(llm: LlmClient, messages: ChatMessage[]): Promise<AttemptOutcome> {
  let raw: string;
  try {
    raw = await llm.complete(messages);
  } catch (error) {
    const retryable = error instanceof LlmCallError ? error.retryable : true;
    return { kind: 'llm_error', error: errorMessage(error), retryable };
  }

  const validation = validateRawOutput(raw);
  if (!validation.ok) {
    return { kind: 'invalid_output', raw, error: validation.error };
  }
  return { kind: 'success', raw, result: validation.result };
}

// No markdown-fence stripping or JSON repair: structured output should prevent them,
// and repairing would hide real model failures that the correction loop should see.
export function validateRawOutput(raw: string):
  { ok: true; result: AnalysisResult } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `Response is not valid JSON: ${errorMessage(error)}` };
  }

  const validation = analysisResultSchema.safeParse(parsed);
  if (!validation.success) {
    return { ok: false, error: z.prettifyError(validation.error) };
  }
  return { ok: true, result: validation.data };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
