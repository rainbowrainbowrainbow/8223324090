/**
 * middleware/errors.js — Custom error classes
 *
 * Instead of manually setting res.status(X).json({error: '...'}) everywhere,
 * routes throw these errors. The centralized errorHandler catches them
 * and sends the correct HTTP response automatically.
 *
 * Usage in routes:
 *   throw new ValidationError('Invalid date format');
 *   throw new ConflictError('Час зайнятий', { conflictWith: {...} });
 *   throw new NotFoundError('Бронювання не знайдено');
 */

class AppError extends Error {
    constructor(message, statusCode, details) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.details = details;
    }
}

// 400 — bad input (missing fields, wrong format, etc.)
class ValidationError extends AppError {
    constructor(message = 'Invalid input', details) {
        super(message, 400, details);
    }
}

// 401 — not logged in or bad token
class AuthError extends AppError {
    constructor(message = 'Невірні дані авторизації') {
        super(message, 401);
    }
}

// 403 — logged in but not allowed
class ForbiddenError extends AppError {
    constructor(message = 'Доступ заборонено') {
        super(message, 403);
    }
}

// 404 — resource doesn't exist
class NotFoundError extends AppError {
    constructor(message = 'Не знайдено') {
        super(message, 404);
    }
}

// 409 — conflict (time overlap, duplicate, etc.)
class ConflictError extends AppError {
    constructor(message = 'Конфлікт даних', details) {
        super(message, 409, details);
    }
}

module.exports = {
    AppError,
    ValidationError,
    AuthError,
    ForbiddenError,
    NotFoundError,
    ConflictError
};
