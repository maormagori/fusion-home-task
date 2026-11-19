import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { feedbackRoutes, type FeedbackRoutesOptions } from './feedback.routes.js';

const BAD_REQUEST = 400;

export function buildApp(deps: FeedbackRoutesOptions): FastifyInstance {
  const app = Fastify({ logger: true });
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
