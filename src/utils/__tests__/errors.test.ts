import { describe, it, expect } from 'vitest';
import { AppError } from '../errors.js';

describe('AppError', () => {
  it('creates with correct properties', () => {
    const err = new AppError(400, 'VALIDATION_FAILED', 'Test error');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toBe('Test error');
    expect(err.name).toBe('AppError');
    expect(err instanceof Error).toBe(true);
  });

  it('creates badRequest', () => {
    const err = AppError.badRequest('VALIDATION_FAILED', 'Bad request');
    expect(err.statusCode).toBe(400);
  });

  it('creates unauthorized', () => {
    const err = AppError.unauthorized();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('creates forbidden', () => {
    const err = AppError.forbidden();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('AUTH_INSUFFICIENT_ROLE');
  });

  it('creates notFound', () => {
    const err = AppError.notFound('EVENT_NOT_FOUND', 'Not found');
    expect(err.statusCode).toBe(404);
  });

  it('creates tooManyRequests', () => {
    const err = AppError.tooManyRequests();
    expect(err.statusCode).toBe(429);
  });

  it('creates internal', () => {
    const err = AppError.internal();
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
  });

  it('includes details', () => {
    const details = [{ field: 'email', message: 'Invalid' }];
    const err = AppError.badRequest('VALIDATION_FAILED', 'Error', details);
    expect(err.details).toEqual(details);
  });
});
