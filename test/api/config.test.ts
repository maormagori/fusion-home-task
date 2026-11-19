import { StatusCodes } from 'http-status-codes';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app.js';
import { CONFIG_PATH, configResponseSchema } from '../../src/api/feedback.schemas.js';
import { IN_MEMORY_PATH, openDatabase } from '../../src/db/database.js';
import { createFeedbackRepository } from '../../src/feedback/feedback.repository.js';
import { createLogger } from '../../src/logger.js';
import { createTestConfig } from '../helpers/test-config.js';

describe('GET /config', () => {
  it('returns the max content length the app was built with', async () => {
    const config = createTestConfig();
    const app = buildApp({
      repo: createFeedbackRepository(openDatabase(IN_MEMORY_PATH)),
      enqueue: () => {},
      maxContentLength: config.MAX_CONTENT_LENGTH,
      logger: createLogger('silent'),
    });

    const response = await app.inject({ method: 'GET', url: CONFIG_PATH });

    expect(response.statusCode).toBe(StatusCodes.OK);
    expect(configResponseSchema.parse(response.json())).toEqual({ maxContentLength: config.MAX_CONTENT_LENGTH });
    await app.close();
  });
});
