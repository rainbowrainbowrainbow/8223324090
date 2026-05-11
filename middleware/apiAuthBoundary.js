'use strict';

/**
 * Central API auth boundary.
 *
 * Express mounts this under /api, so paths here are API-local, e.g.
 * /landing/demo-request instead of /api/landing/demo-request.
 */

const PUBLIC_API_ROUTES = [
    { prefix: '/auth/' },
    { method: 'GET', path: '/health' },
    { method: 'GET', path: '/version' },
    { method: 'POST', path: '/telegram/webhook' },
    { method: 'POST', path: '/report-bot/webhook' },
    { method: 'POST', path: '/report-bot/submit' },
    { method: 'GET', path: '/report-bot/on-duty' },
    { method: 'GET', path: '/report-bot/summary' },
    { method: 'GET', path: '/report-bot/accounts' },
    { method: 'GET', path: '/report-bot/submissions' },
    { method: 'POST', path: '/personal-accounts/sync' },
    { method: 'GET', path: '/personal-accounts/my' },
    { method: 'POST', regex: /^\/personal-accounts\/[^/]+\/grant$/ },
    { method: 'DELETE', regex: /^\/personal-accounts\/[^/]+\/access\/[^/]+$/ },
    { method: 'GET', regex: /^\/personal-accounts\/[^/]+\/transactions$/ },
    { method: 'POST', regex: /^\/personal-accounts\/[^/]+\/transactions$/ },
    { method: 'POST', path: '/kleshnya/webhook' },
    { method: 'GET', path: '/kleshnya/pending-messages' },
    { method: 'POST', path: '/kleshnya/sync-chat' },
    { method: 'POST', path: '/demo/login' },
    { method: 'GET', path: '/demo/scenarios' },
    { method: 'GET', path: '/packages' },
    { method: 'GET', path: '/status/public' },
    { method: 'POST', path: '/leads/landing' },
    { method: 'POST', path: '/landing/demo-request' }
];

const QUERY_TOKEN_AUTH_ROUTES = [
    { method: 'GET', regex: /^\/graduation\/quotes\/[^/]+\/proposal$/ },
    { method: 'GET', path: '/graduation/catalog/export' }
];

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
