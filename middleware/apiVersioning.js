/**
 * middleware/apiVersioning.js — API versioning & deprecation support
 * v19.10: Support /api/v1/ prefix and deprecation headers.
 */

/**
 * Middleware that rewrites /api/v1/* to /api/* for backwards compatibility.
 * When the API evolves to v2, v1 routes can be handled separately.
 */
function apiVersionRewrite(req, res, next) {
    if (req.url.startsWith('/api/v1/')) {
        req.url = '/api/' + req.url.slice(8);
        res.setHeader('X-API-Version', '1');
    }
    next();
}

/**
 * Create deprecation middleware for specific endpoints.
 * Adds Deprecation and Sunset headers per RFC 8594.
 *
 * @param {string} sunsetDate - ISO date when endpoint will be removed (e.g. '2026-06-01')
 * @param {string} [alternative] - Suggested alternative endpoint
 */
function deprecated(sunsetDate, alternative) {
    return (req, res, next) => {
        res.setHeader('Deprecation', 'true');
        if (sunsetDate) {
            res.setHeader('Sunset', new Date(sunsetDate).toUTCString());
        }
        if (alternative) {
            res.setHeader('Link', `<${alternative}>; rel="successor-version"`);
        }
        next();
    };
}

module.exports = { apiVersionRewrite, deprecated };
