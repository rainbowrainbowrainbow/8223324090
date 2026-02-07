/**
 * middleware/requestLogger.js — API request logging
 *
 * Logs every API request with method, path, status, duration, and user.
 * Only logs /api/* routes to avoid noise from static file requests.
 *
 * Output format:
 *   [API] POST /api/bookings 200 45ms user=Sergey
 *   [API] GET /api/health 200 2ms
 *   [API] POST /api/auth/login 401 12ms
 */

function requestLogger(req, res, next) {
    // Only log API requests
    if (!req.path.startsWith('/api')) {
        return next();
    }

    const start = Date.now();

    // Hook into response finish event
    res.on('finish', () => {
        const duration = Date.now() - start;
        const user = req.user?.username || '';
        const userStr = user ? ` user=${user}` : '';
        const status = res.statusCode;

        // Color-code by status for readability in terminals
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'log';

        console[level](`[API] ${req.method} ${req.originalUrl} ${status} ${duration}ms${userStr}`);
    });

    next();
}

module.exports = requestLogger;
