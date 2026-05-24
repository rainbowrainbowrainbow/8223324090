/**
 * Adds trace metadata to API error responses that are built inside route
 * handlers, not only errors that reach the global Express error handler.
 */
function errorResponseMetadata(req, res, next) {
    const originalJson = res.json.bind(res);

    res.json = function jsonWithErrorMetadata(body) {
        if (res.statusCode >= 500 && body && typeof body === 'object' && !Array.isArray(body)) {
            const requestId = res.getHeader('X-Request-ID') || req.headers['x-request-id'];
            const payload = { ...body };
            if (requestId && !payload.requestId) payload.requestId = String(requestId);
            if (payload.error && payload.success === undefined) payload.success = false;
            return originalJson(payload);
        }
        return originalJson(body);
    };

    next();
}

module.exports = { errorResponseMetadata };
