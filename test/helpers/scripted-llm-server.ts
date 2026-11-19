import { createServer, type ServerResponse } from 'node:http';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { TEST_HOST } from './test-config.js';

const requestSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })),
  response_format: z.object({ type: z.literal('json_schema'), json_schema: z.object({ strict: z.boolean() }) }),
});

interface ScriptedCompletion {
  kind: 'completion';
  content: string | null;
  emptyChoices?: boolean;
  delayMs?: number;
  waitFor?: Promise<void>;
}

export type ScriptedReply =
  | ScriptedCompletion
  | { kind: 'http_error'; status: number; message: string };

export interface ScriptedLlmServer {
  baseUrl: string;
  requests: z.infer<typeof requestSchema>[];
  close(): Promise<void>;
}

export async function createScriptedLlmServer(replies: ScriptedReply[]): Promise<ScriptedLlmServer> {
  const requests: z.infer<typeof requestSchema>[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const reply = replies[requests.length];
    const completionRequest = requestSchema.parse(JSON.parse(body));
    requests.push(completionRequest);
    if (!reply) {
      response.writeHead(StatusCodes.INTERNAL_SERVER_ERROR).end('Unexpected extra request');
      return;
    }
    if (reply.kind === 'http_error') {
      response.writeHead(reply.status, { 'content-type': 'application/json', 'retry-after-ms': '1' });
      response.end(JSON.stringify({ error: { message: reply.message, type: 'test_error' } }));
      return;
    }
    await reply.waitFor;
    const timer = setTimeout(() => {
      timers.delete(timer);
      sendCompletion(response, reply, completionRequest.model);
    }, reply.delayMs ?? 0);
    timers.add(timer);
  });
  await new Promise<void>((resolve) => server.listen(0, TEST_HOST, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Scripted LLM did not bind a TCP port');
  }
  return {
    baseUrl: `http://${TEST_HOST}:${address.port}/v1`,
    requests,
    async close(): Promise<void> {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function sendCompletion(response: ServerResponse, reply: ScriptedCompletion, model: string): void {
  response.writeHead(StatusCodes.OK, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    id: 'scripted-completion', object: 'chat.completion', created: 0, model,
    choices: reply.emptyChoices ? [] : [{ index: 0, message: { role: 'assistant', content: reply.content }, finish_reason: 'stop' }],
  }));
}
