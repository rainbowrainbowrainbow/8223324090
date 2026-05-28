'use strict';

const {
  BUSINESS_SCOPE_SINGLE,
  businessScopeModeFromRequest,
  isBusinessScopeReadOnly,
  resolveBusinessScope
} = require('../services/businessContext');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXEMPT_PATHS = new Set([
  '/api/auth/log-action',
  '/auth/log-action'
]);

function normalizedApiPath(req) {
  const raw = String(req.path || req.url || '/').split('?')[0];
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function businessScopeWriteGuard(req, res, next) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!MUTATING_METHODS.has(method)) return next();
  if (!req.user) return next();
  if (EXEMPT_PATHS.has(normalizedApiPath(req))) return next();

  const requestedMode = businessScopeModeFromRequest(req);
  if (requestedMode === BUSINESS_SCOPE_SINGLE) return next();

  const scope = resolveBusinessScope(req);
  if (scope.invalid) {
    return res.status(403).json({
      success: false,
      error: 'Business scope is not available for this user',
      code: scope.reason || 'business_scope_unavailable'
    });
  }
  if (isBusinessScopeReadOnly(scope)) {
    return res.status(403).json({
      success: false,
      error: 'All-business and multi-business scopes are read-only. Select one active business before changing data.',
      code: 'business_scope_read_only'
    });
  }
  return next();
}

module.exports = {
  businessScopeWriteGuard,
  normalizedApiPath
};
