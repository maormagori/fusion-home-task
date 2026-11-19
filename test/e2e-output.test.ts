import { afterEach, describe, expect, it } from 'vitest';
import { buildCorrectionMessages, buildInitialMessages } from '../src/analysis/prompt.js';
import { feedbackStatusSchema } from '@feedback/shared/models';
import { createScriptedWorkflow, VALID_ANALYSIS, VALID_RAW, type ScriptedWorkflow } from './helpers/scripted-workflow.js';
import { expectSettled, waitForIdle } from './helpers/workflow-harness.js';

const { DONE, FAILED } = feedbackStatusSchema.enum;
let workflow: ScriptedWorkflow;

afterEach(async () => {
  await workflow.close();
});

describe('scripted output through HTTP, SDK, queue and SQLite', () => {
  it('H01/A01 corrects invalid output with full conversation and retains both attempts', async () => {
    const invalid = '{broken';
    const content = 'Please add offline editing.';
    workflow = await createScriptedWorkflow([
      { kind: 'completion', content: invalid }, { kind: 'completion', content: VALID_RAW },
    ]);
    const feedbackId = await workflow.submit(content);
    await waitForIdle(workflow.queue);
    const detail = await workflow.detail(feedbackId);

    expectSettled(detail);
    expect(detail.status).toBe(DONE);
    expect(detail.attempts).toHaveLength(2);
    const first = detail.attempts[0];
    expect(first).toMatchObject({ rawResponse: invalid, result: null, error: expect.any(String) });
    expect(detail.attempts[1]).toMatchObject({ rawResponse: VALID_RAW, result: VALID_ANALYSIS, error: null });
    expect(workflow.server.requests).toHaveLength(2);
    expect(workflow.server.requests[0]).toMatchObject({
      model: workflow.config.LLM_MODEL, messages: buildInitialMessages(content),
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    });
    expect(workflow.server.requests[1]?.messages).toEqual([
      ...buildInitialMessages(content), ...buildCorrectionMessages(invalid, first?.error ?? ''),
    ]);
  });

  it.each([
    ['extra top-level key', { ...VALID_ANALYSIS, extra: true }],
    ['extra feature key', { ...VALID_ANALYSIS, feature_requests: [{ title: 'Offline', confidence: 1, extra: true }] }],
    ['confidence below zero', { ...VALID_ANALYSIS, feature_requests: [{ title: 'Offline', confidence: -0.1 }] }],
    ['confidence above one', { ...VALID_ANALYSIS, feature_requests: [{ title: 'Offline', confidence: 1.1 }] }],
    ['wrong sentiment', { ...VALID_ANALYSIS, sentiment: 'furious' }],
    ['missing field', { sentiment: VALID_ANALYSIS.sentiment, feature_requests: [] }],
    ['empty title', { ...VALID_ANALYSIS, feature_requests: [{ title: '', confidence: 1 }] }],
    ['empty insight', { ...VALID_ANALYSIS, actionable_insight: '' }],
    ['wrong type', { ...VALID_ANALYSIS, feature_requests: 'Offline' }],
  ])('A02 rejects %s then corrects it end to end', async (_name, invalid) => {
    await expectCorrection(JSON.stringify(invalid));
  });

  it.each([
    ['non-JSON', 'hacked'],
    ['fenced JSON', `\`\`\`json\n${VALID_RAW}\n\`\`\``],
    ['whitespace', '   \n\t'],
  ])('A03 preserves %s verbatim rather than repairing it', async (_name, invalid) => {
    await expectCorrection(invalid);
  });

  it('A04 exhausts invalid outputs and saves every distinct raw response and error', async () => {
    const replies = ['not JSON', JSON.stringify({ ...VALID_ANALYSIS, sentiment: 'furious' }), '{}'];
    workflow = await createScriptedWorkflow(replies.map((content) => ({ kind: 'completion', content })), {
      MAX_ATTEMPTS: String(replies.length),
    });
    const feedbackId = await workflow.submit('Repeated invalid model answers');
    await waitForIdle(workflow.queue);
    const detail = await workflow.detail(feedbackId);

    expectSettled(detail);
    expect(detail.status).toBe(FAILED);
    expect(detail.attempts.map((attempt) => attempt.rawResponse)).toEqual(replies);
    for (const attempt of detail.attempts) {
      expect(attempt.result).toBeNull();
      expect(attempt.error).toEqual(expect.any(String));
    }
    expect(workflow.server.requests).toHaveLength(workflow.config.MAX_ATTEMPTS);
    await waitForIdle(workflow.queue);
    expect((await workflow.detail(feedbackId)).attempts).toEqual(detail.attempts);
  });

  it('A05 stores empty-string completion as invalid output and asks for correction', async () => {
    await expectCorrection('');
  });

  it.each(['null content', 'no choices'])('A05 treats %s as an LLM error, without correction', async (kind) => {
    workflow = await createScriptedWorkflow([
      { kind: 'completion', content: null, emptyChoices: kind === 'no choices' },
      { kind: 'completion', content: VALID_RAW },
    ]);
    const feedbackId = await workflow.submit('Missing model completion');
    await waitForIdle(workflow.queue);
    const detail = await workflow.detail(feedbackId);

    expectSettled(detail);
    expect(detail.status).toBe(DONE);
    expect(detail.attempts).toHaveLength(2);
    expect(detail.attempts[0]).toMatchObject({ rawResponse: null, result: null, error: expect.any(String) });
    expect(workflow.server.requests[1]?.messages).toEqual(workflow.server.requests[0]?.messages);
  });
});

async function expectCorrection(invalid: string): Promise<void> {
  workflow = await createScriptedWorkflow([
    { kind: 'completion', content: invalid }, { kind: 'completion', content: VALID_RAW },
  ]);
  const feedbackId = await workflow.submit('Correct this model output');
  await waitForIdle(workflow.queue);
  const detail = await workflow.detail(feedbackId);
  expectSettled(detail);
  expect(detail.status).toBe(DONE);
  expect(detail.attempts).toHaveLength(2);
  expect(detail.attempts[0]).toMatchObject({ rawResponse: invalid, result: null, error: expect.any(String) });
  expect(detail.attempts[1]).toMatchObject({ rawResponse: VALID_RAW, result: VALID_ANALYSIS, error: null });
  expect(workflow.server.requests[1]?.messages.slice(-2)).toEqual(
    buildCorrectionMessages(invalid, detail.attempts[0]?.error ?? ''),
  );
}
