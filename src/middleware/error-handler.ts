import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import type { ApiErrorResponse } from '../types/index.js';

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // Known application error
  if (error instanceof AppError) {
    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
    return reply.status(error.statusCode).send(body);
  }

  // Fastify validation error
  if ('validation' in error && error.validation) {
    const body: ApiErrorResponse = {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Помилка валідації',
        details: error.validation.map((v) => ({
          field: v.instancePath?.replace('/', '') || 'unknown',
          message: v.message || 'Невірне значення',
        })),
      },
    };
    return reply.status(400).send(body);
  }

  // Unexpected error
  request.log.error(error, 'Unhandled error');

  const body: ApiErrorResponse = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message:
        env.NODE_ENV === 'production'
          ? 'Внутрішня помилка сервера'
          : error.message || 'Unknown error',
    },
  };

  return reply.status(500).send(body);
}
