'use strict';

/**
 * Central API auth boundary.
 *
 * Express mounts this under /api, so paths here are API-local, e.g.
 * /landing/demo-request instead of /api/landing/demo-request.
 */

const {
    PUBLIC_API_ROUTES,
    QUERY_TOKEN_AUTH_ROUTES
} = require('../config/authBoundary');

function normalizePath(path) {
    if (!path) return '/';
    return path.startsWith('/') ? path : `/${path}`;
}

function routeMatches(req, route) {
    const method = String(req.method || 'GET').toUpperCase();
    const path = normalizePath(req.path || req.url || '/').split('?')[0];

    if (route.method && route.method !== method) return false;
    if (route.path) return path === route.path;
    if (route.prefix) return path === route.prefix || path.startsWith(route.prefix);
    if (route.regex) return route.regex.test(path);
    return false;
}

function isPublicApiRequest(req) {
    return PUBLIC_API_ROUTES.some(route => routeMatches(req, route));
}

function isQueryTokenAuthAllowed(req) {
    return QUERY_TOKEN_AUTH_ROUTES.some(route => routeMatches(req, route));
}

function apiAuthBoundary(authenticateToken) {
    return function apiAuthBoundaryMiddleware(req, res, next) {
        if (isPublicApiRequest(req)) {
            return next();
        }

        if (!req.headers.authorization && req.query?.token && isQueryTokenAuthAllowed(req)) {
            req.headers.authorization = `Bearer ${req.query.token}`;
        }

        return authenticateToken(req, res, next);
    };
}

module.exports = {
    PUBLIC_API_ROUTES,
    QUERY_TOKEN_AUTH_ROUTES,
    apiAuthBoundary,
    isPublicApiRequest,
    isQueryTokenAuthAllowed
};
