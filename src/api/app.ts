import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Config } from '../config.js';
import { feedbackRoutes, type FeedbackRoutesOptions } from './feedback.routes.js';

const BAD_REQUEST = 400;

export function buildApp(deps: FeedbackRoutesOptions & { logLevel: Config['LOG_LEVEL'] }): FastifyInstance {
  const app = Fastify({ logger: { level: deps.logLevel } });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, _request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(BAD_REQUEST).send({ error: error.message });
    }
    // Anything else goes to Fastify's default handler.
    throw error;
  });

  app.register(feedbackRoutes, deps);
  return app;
}
