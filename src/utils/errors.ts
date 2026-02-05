import { API_ERROR_CODE, type ApiErrorCodeType, type ApiErrorDetail } from '../types/index.js';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCodeType;
  readonly details?: ApiErrorDetail[];

  constructor(
    statusCode: number,
    code: ApiErrorCodeType,
    message: string,
    details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: ApiErrorCodeType, message: string, details?: ApiErrorDetail[]) {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = 'Необхідна авторизація') {
    return new AppError(401, API_ERROR_CODE.AUTH_INVALID_TOKEN, message);
  }

  static forbidden(message = 'Недостатньо прав') {
    return new AppError(403, API_ERROR_CODE.AUTH_INSUFFICIENT_ROLE, message);
  }

  static notFound(code: ApiErrorCodeType, message: string) {
    return new AppError(404, code, message);
  }

  static tooManyRequests(message = 'Забагато запитів') {
    return new AppError(429, API_ERROR_CODE.RATE_LIMIT_EXCEEDED, message);
  }

  static internal(message = 'Внутрішня помилка сервера') {
    return new AppError(500, API_ERROR_CODE.INTERNAL_ERROR, message);
  }
}
