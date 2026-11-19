import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FeedbackRepository } from '../feedback/feedback.repository.js';
import {
  createSubmitFeedbackBodySchema,
  errorResponseSchema,
  feedbackDetailSchema,
  feedbackIdParamsSchema,
  feedbackListResponseSchema,
  listFeedbackQuerySchema,
  retryConflictResponseSchema,
  retryFeedbackResponseSchema,
  submitFeedbackResponseSchema,
} from './feedback.schemas.js';

export interface FeedbackRoutesOptions {
  repo: FeedbackRepository;
  enqueue: (feedbackId: string) => void;
  maxContentLength: number;
}

const FEEDBACK_NOT_FOUND = 'Feedback not found';
const ONLY_FAILED_CAN_BE_RETRIED = 'Only FAILED feedback can be retried';

export const feedbackRoutes: FastifyPluginAsyncZod<FeedbackRoutesOptions> = async (
  app,
  { repo, enqueue, maxContentLength },
) => {
  app.post('/feedback', {
    schema: {
      body: createSubmitFeedbackBodySchema(maxContentLength),
      response: {
        202: submitFeedbackResponseSchema,
        200: submitFeedbackResponseSchema,
        400: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { feedback, created } = repo.insertOrGetExisting(request.body.content);
    if (!created) {
      return reply.code(200).send({ id: feedback.id, status: feedback.status, duplicate: true });
    }
    enqueue(feedback.id);
    return reply.code(202).send({ id: feedback.id, status: feedback.status, duplicate: false });
  });

  app.get('/feedback', {
    schema: {
      querystring: listFeedbackQuerySchema,
      response: {
        200: feedbackListResponseSchema,
        400: errorResponseSchema,
      },
    },
  }, async (request) => {
    const { status, limit, offset } = request.query;
    return { items: repo.list({ status, limit, offset }), limit, offset };
  });

  app.get('/feedback/:id', {
    schema: {
      params: feedbackIdParamsSchema,
      response: {
        200: feedbackDetailSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const detail = repo.getDetail(request.params.id);
    if (!detail) {
      return reply.code(404).send({ error: FEEDBACK_NOT_FOUND });
    }
    return detail;
  });

  app.post('/feedback/:id/retry', {
    schema: {
      params: feedbackIdParamsSchema,
      response: {
        202: retryFeedbackResponseSchema,
        404: errorResponseSchema,
        409: retryConflictResponseSchema,
      },
    },
  }, async (request, reply) => {
    const feedbackId = request.params.id;
    const feedback = repo.findById(feedbackId);
    if (!feedback) {
      return reply.code(404).send({ error: FEEDBACK_NOT_FOUND });
    }
    const wasRetried = repo.transition(feedbackId, 'FAILED', 'RECEIVED');
    if (!wasRetried) {
      return reply.code(409).send({ error: ONLY_FAILED_CAN_BE_RETRIED, status: feedback.status });
    }
    enqueue(feedbackId);
    return reply.code(202).send({ id: feedbackId, status: 'RECEIVED' });
  });
};
