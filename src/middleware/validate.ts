import type { FastifyRequest, FastifyReply } from 'fastify';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from '../utils/errors.js';
import { API_ERROR_CODE } from '../types/index.js';

interface ValidateOptions {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

export function validate(schemas: ValidateOptions) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      if (schemas.body) {
        request.body = schemas.body.parse(request.body);
      }
      if (schemas.params) {
        request.params = schemas.params.parse(request.params);
      }
      if (schemas.query) {
        request.query = schemas.query.parse(request.query);
      }
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));

        throw AppError.badRequest(
          API_ERROR_CODE.VALIDATION_FAILED,
          'Помилка валідації',
          details,
        );
      }
      throw err;
    }
  };
}
