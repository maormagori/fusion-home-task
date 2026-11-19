import { StatusCodes } from 'http-status-codes';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { feedbackDetailSchema, feedbackStatusSchema } from '../domain/types.js';
import type { FeedbackRepository } from '../feedback/feedback.repository.js';
import {
  createSubmitFeedbackBodySchema,
  FEEDBACK_PATH,
  FEEDBACK_DETAIL_PATH,
  FEEDBACK_RETRY_PATH,
  errorResponseSchema,
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

export const FEEDBACK_NOT_FOUND = 'Feedback not found';
export const ONLY_FAILED_CAN_BE_RETRIED = 'Only FAILED feedback can be retried';

export const feedbackRoutes: FastifyPluginAsyncZod<FeedbackRoutesOptions> = async (
  app,
  { repo, enqueue, maxContentLength },
) => {
  app.post(FEEDBACK_PATH, {
    schema: {
      body: createSubmitFeedbackBodySchema(maxContentLength),
      response: {
        [StatusCodes.ACCEPTED]: submitFeedbackResponseSchema,
        [StatusCodes.OK]: submitFeedbackResponseSchema,
        [StatusCodes.BAD_REQUEST]: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { feedback, created } = repo.insertOrGetExisting(request.body.content);
    if (!created) {
      return reply.code(StatusCodes.OK).send({ id: feedback.id, status: feedback.status, duplicate: true });
    }
    enqueue(feedback.id);
    return reply.code(StatusCodes.ACCEPTED).send({ id: feedback.id, status: feedback.status, duplicate: false });
  });

  app.get(FEEDBACK_PATH, {
    schema: {
      querystring: listFeedbackQuerySchema,
      response: {
        [StatusCodes.OK]: feedbackListResponseSchema,
        [StatusCodes.BAD_REQUEST]: errorResponseSchema,
      },
    },
  }, async (request) => {
    const { status, limit, offset } = request.query;
    return { items: repo.list({ status, limit, offset }), limit, offset };
  });

  app.get(FEEDBACK_DETAIL_PATH, {
    schema: {
      params: feedbackIdParamsSchema,
      response: {
        [StatusCodes.OK]: feedbackDetailSchema,
        [StatusCodes.NOT_FOUND]: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const detail = repo.getDetail(request.params.id);
    if (!detail) {
      return reply.code(StatusCodes.NOT_FOUND).send({ error: FEEDBACK_NOT_FOUND });
    }
    return detail;
  });

  app.post(FEEDBACK_RETRY_PATH, {
    schema: {
      params: feedbackIdParamsSchema,
      response: {
        [StatusCodes.ACCEPTED]: retryFeedbackResponseSchema,
        [StatusCodes.NOT_FOUND]: errorResponseSchema,
        [StatusCodes.CONFLICT]: retryConflictResponseSchema,
      },
    },
  }, async (request, reply) => {
    const feedbackId = request.params.id;
    const feedback = repo.findById(feedbackId);
    if (!feedback) {
      return reply.code(StatusCodes.NOT_FOUND).send({ error: FEEDBACK_NOT_FOUND });
    }
    const wasRetried = repo.transition(feedbackId, feedbackStatusSchema.enum.FAILED, feedbackStatusSchema.enum.RECEIVED);
    if (!wasRetried) {
      return reply.code(StatusCodes.CONFLICT).send({ error: ONLY_FAILED_CAN_BE_RETRIED, status: feedback.status });
    }
    enqueue(feedbackId);
    return reply.code(StatusCodes.ACCEPTED).send({ id: feedbackId, status: feedbackStatusSchema.enum.RECEIVED });
  });
};
