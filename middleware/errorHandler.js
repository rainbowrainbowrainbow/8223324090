/**
 * middleware/errorHandler.js — Centralized error handling
 *
 * Two exports:
 *
 * 1. asyncHandler(fn) — wraps async route handlers so thrown errors
 *    are caught and passed to Express error middleware automatically.
 *    Without this, async errors crash the process instead of returning 500.
 *
 * 2. errorHandler(err, req, res, next) — Express error middleware
 *    (must have 4 arguments). Catches ALL errors from all routes
 *    and sends a consistent JSON response.
 */

const { AppError } = require('./errors');

/**
 * Wraps an async route handler to catch rejected promises.
 *
 * Usage:
 *   router.get('/foo', asyncHandler(async (req, res) => {
 *       const data = await db.query(...);
 *       throw new NotFoundError(); // automatically caught!
 *       res.json(data);
 *   }));
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Express error middleware — the "safety net" at the end of the middleware chain.
 *
 * If error is one of our AppError subclasses → send its status + message.
 * If error is unknown (e.g. DB crash, null reference) → send generic 500.
 * Never leak stack traces or internal details to the client.
 */
function errorHandler(err, req, res, next) {
    // Already sent headers? Let Express default handler deal with it
    if (res.headersSent) {
        return next(err);
    }

    // Our custom errors — we control the message and status
    if (err instanceof AppError) {
        const response = { error: err.message };
        // Include details if present (e.g. conflictWith for 409)
        if (err.details) {
            Object.assign(response, err.details);
        }
        return res.status(err.statusCode).json(response);
    }

    // Unknown errors — log full details but send generic message to client
    console.error(`[Error] ${req.method} ${req.path}:`, err);
    res.status(500).json({ error: 'Internal server error' });
}

module.exports = { asyncHandler, errorHandler };
