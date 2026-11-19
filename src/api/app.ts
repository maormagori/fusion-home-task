import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { StatusCodes } from 'http-status-codes';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Logger } from '../logger.js';
import { feedbackRoutes, type FeedbackRoutesOptions } from './feedback.routes.js';

export interface BuildAppOptions extends FeedbackRoutesOptions {
  logger: Logger;
  uiDistPath?: string;
}

export function buildApp(deps: BuildAppOptions): FastifyInstance {
  // Typed as Fastify's base logger so buildApp keeps returning the plain FastifyInstance from the contract.
  const loggerInstance: FastifyBaseLogger = deps.logger;
  const app = Fastify({ loggerInstance });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(StatusCodes.BAD_REQUEST).send({ error: error.message });
    }
    throw error;
  });

  app.register(feedbackRoutes, deps);
  // The UI is optional: API-only runs (tests, CI without a web build) have no built folder to serve.
  if (deps.uiDistPath && existsSync(deps.uiDistPath)) {
    // @fastify/static needs an absolute root; UI_DIST_PATH is relative to the working directory, like DB_PATH.
    app.register(fastifyStatic, { root: resolve(deps.uiDistPath) });
  }
  return app;
}
