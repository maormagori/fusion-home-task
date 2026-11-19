import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StatusCodes } from 'http-status-codes';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { FEEDBACK_PATH, feedbackListResponseSchema } from '@feedback/shared/api';
import { IN_MEMORY_PATH, openDatabase } from '../../src/db/database.js';
import { createFeedbackRepository } from '../../src/feedback/feedback.repository.js';
import { createLogger } from '../../src/logger.js';
import { createTestConfig } from '../helpers/test-config.js';

const INDEX_HTML = '<!doctype html><title>Feedback Insights</title>';

let uiDistPath: string;

function buildTestApp(uiDistPathOption: string | undefined): FastifyInstance {
  return buildApp({
    repo: createFeedbackRepository(openDatabase(IN_MEMORY_PATH)),
    enqueue: () => {},
    maxContentLength: createTestConfig().MAX_CONTENT_LENGTH,
    logger: createLogger('silent'),
    uiDistPath: uiDistPathOption,
  });
}

beforeEach(() => {
  uiDistPath = mkdtempSync(join(tmpdir(), 'feedback-ui-'));
  writeFileSync(join(uiDistPath, 'index.html'), INDEX_HTML);
});

afterEach(() => {
  rmSync(uiDistPath, { recursive: true, force: true });
});

describe('static UI', () => {
  it('serves index.html at / and keeps the API routes working', async () => {
    const app = buildTestApp(uiDistPath);

    const page = await app.inject({ method: 'GET', url: '/' });
    const list = await app.inject({ method: 'GET', url: FEEDBACK_PATH });

    expect(page.statusCode).toBe(StatusCodes.OK);
    expect(page.body).toBe(INDEX_HTML);
    expect(list.statusCode).toBe(StatusCodes.OK);
    expect(feedbackListResponseSchema.parse(list.json()).items).toEqual([]);
    await app.close();
  });

  it('serves nothing at / when the UI folder does not exist', async () => {
    const app = buildTestApp(join(uiDistPath, 'missing'));

    const page = await app.inject({ method: 'GET', url: '/' });

    expect(page.statusCode).toBe(StatusCodes.NOT_FOUND);
    await app.close();
  });
});
