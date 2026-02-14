/**
 * middleware/requestId.js — Request ID generation & AsyncLocalStorage context
 *
 * Generates unique request ID for each incoming request.
 * Stores it in AsyncLocalStorage so any logger.* call automatically includes it.
 * Also logs request start/finish with method, path, status, duration.
 */
const crypto = require('crypto');
const { asyncLocalStorage } = require('../utils/logger');
const { createLogger } = require('../utils/logger');

const log = createLogger('HTTP');

function requestIdMiddleware(req, res, next) {
    const requestId = req.headers['x-request-id'] || crypto.randomBytes(6).toString('hex');

    const store = {
        requestId,
        method: req.method,
        path: req.originalUrl || req.url
    };

    res.setHeader('X-Request-ID', requestId);

    asyncLocalStorage.run(store, () => {
        const start = Date.now();

        log.info(`${req.method} ${store.path}`);

        const originalEnd = res.end;
        res.end = function (...args) {
            const duration = Date.now() - start;
            log.info(`${req.method} ${store.path} ${res.statusCode} ${duration}ms`);
            originalEnd.apply(res, args);
        };

        next();
    });
}

module.exports = { requestIdMiddleware };
