import { analysisResultSchema, sentimentSchema } from '../../src/analysis/analysis.schema.js';
import { createScriptedLlmServer, type ScriptedLlmServer, type ScriptedReply } from './scripted-llm-server.js';
import { createTestConfig } from './test-config.js';
import { createWorkflowHarness, type WorkflowHarness } from './workflow-harness.js';

export const VALID_ANALYSIS = analysisResultSchema.parse({
  sentiment: sentimentSchema.enum.negative,
  feature_requests: [{ title: 'Offline mode', confidence: 0.9 }],
  actionable_insight: 'Add offline editing.',
});
export const VALID_RAW = JSON.stringify(VALID_ANALYSIS);

export interface ScriptedWorkflow extends WorkflowHarness {
  server: ScriptedLlmServer;
}

export async function createScriptedWorkflow(
  replies: ScriptedReply[],
  overrides: NodeJS.ProcessEnv = {},
): Promise<ScriptedWorkflow> {
  const server = await createScriptedLlmServer(replies);
  const harness = createWorkflowHarness(createTestConfig({
    LLM_BASE_URL: server.baseUrl, LLM_SDK_MAX_RETRIES: '0', ...overrides,
  }));
  return {
    ...harness,
    server,
    async close(): Promise<void> {
      try {
        await harness.close();
      } finally {
        await server.close();
      }
    },
  };
}
